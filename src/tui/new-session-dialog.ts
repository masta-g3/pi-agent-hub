import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { SessionFavorite } from "../core/session-favorites.js";
import type { NewSessionDialogContext } from "./dialog.js";
import { editTextInput, isEnterKey } from "./text-input.js";
import { renderForm, truncate, type FormField } from "./layout.js";
import { createRepoPicker, moveRepoPickerSelection, renderRepoPicker, selectedRepoCwd, type RepoPickerState } from "./repo-picker.js";
import { openFavoritesDialog, type FavoritesDialog } from "./session-favorites-dialog.js";
import {
  addRepo, createNewForm, cycleCwdSuggestion, editNewForm, isRepoKey,
  removeFocusedRepo, setFocus, setRepoValue, submission, toggleWorktree, validateNewForm,
  type NewFormState, type RepoFieldKey,
} from "./new-form.js";

type NewSessionAction = "favorite" | "add" | "save" | "options" | "create" | "cancel";

export interface NewSessionDialog {
  kind: "new";
  form: NewFormState;
  optionsExpanded?: boolean;
  actionFocus?: NewSessionAction;
  favorite?: SessionFavorite;
}

export interface RepoPickerDialog {
  kind: "repoPicker";
  draft: NewSessionDialog;
  picker: RepoPickerState;
  target: RepoFieldKey;
}

type NewSessionResult = NewSessionDialog | RepoPickerDialog | FavoritesDialog | undefined;

export function openNewSessionDialog(ctx: NewSessionDialogContext): NewSessionDialog {
  const formCtx = ctx.actions.newFormContext?.() ?? { cwd: process.cwd() };
  return { kind: "new", form: createNewForm(formCtx), optionsExpanded: false };
}

export function handleNewSessionInput(dialog: NewSessionDialog | RepoPickerDialog, data: string, ctx: NewSessionDialogContext): NewSessionResult {
  return dialog.kind === "new" ? handleNewFormInput(dialog, data, ctx) : handleRepoPickerInput(dialog, data);
}

export function renderNewSessionDialog(dialog: NewSessionDialog | RepoPickerDialog, width: number, ctx: NewSessionDialogContext): string[] {
  const height = ctx.actions.terminalRows?.();
  if (dialog.kind === "repoPicker") return renderRepoPicker(dialog.picker, width, ctx.theme, height);
  return renderForm({
    title: "New session",
    fields: newFormFields(dialog, width),
    focus: dialog.actionFocus ?? dialog.form.focus,
    footer: newFormFooter(dialog),
    narrowFooter: "^Y create · esc cancel",
    compact: true,
    height,
  }, width, ctx.theme);
}

function handleNewFormInput(dialog: NewSessionDialog, data: string, ctx: NewSessionDialogContext): NewSessionResult {
  const form = dialog.form;
  if (matchesKey(data, Key.escape)) {
    ctx.setMessage(undefined);
    return undefined;
  }
  if (matchesKey(data, Key.ctrl("y"))) return createSession(dialog, ctx);
  if (matchesKey(data, Key.ctrl("f"))) return openFavoritesDialog(dialog, ctx);
  if (matchesKey(data, Key.ctrl("s"))) return openFavoritesDialog(dialog, ctx, "save");
  if (matchesKey(data, Key.ctrl("g"))) return { ...dialog, optionsExpanded: true, actionFocus: undefined, form: setFocus(form, "group") };
  if (matchesKey(data, Key.ctrl("l"))) {
    return { ...dialog, optionsExpanded: true, actionFocus: undefined, form: setFocus(form.worktreeEnabled ? form : toggleWorktree(form), "branch") };
  }
  if (matchesKey(data, Key.ctrl("t")) || (!dialog.actionFocus && form.focus === "worktree" && data === " ")) {
    ctx.setMessage(undefined);
    return { ...dialog, optionsExpanded: true, actionFocus: undefined, form: toggleWorktree(form) };
  }
  if (matchesKey(data, Key.ctrl("r"))) return withForm(dialog, addRepo(form));
  if (matchesKey(data, Key.ctrl("x"))) return dialog.actionFocus ? dialog : withForm(dialog, removeFocusedRepo(form));
  if (matchesKey(data, Key.ctrl("o"))) return startRepoPicker(dialog);
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) return moveDialogFocus(dialog, 1);
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) return moveDialogFocus(dialog, -1);
  if (isEnterKey(data) || (dialog.actionFocus === "options" && data === " ")) {
    switch (dialog.actionFocus) {
      case "favorite": return openFavoritesDialog(dialog, ctx);
      case "save": return openFavoritesDialog(dialog, ctx, "save");
      case "add": return withForm(dialog, addRepo(form));
      case "options": return { ...dialog, optionsExpanded: !dialog.optionsExpanded };
      case "cancel": return undefined;
      case "create": return createSession(dialog, ctx);
    }
    if (form.focus === "worktree") return withForm(dialog, toggleWorktree(form));
    return moveDialogFocus(dialog, 1);
  }
  if (dialog.actionFocus) return dialog;
  if (matchesKey(data, Key.ctrl("n"))) return withForm(dialog, cycleCwdSuggestion(form, 1));
  if (matchesKey(data, Key.ctrl("p"))) return withForm(dialog, cycleCwdSuggestion(form, -1));
  const edited = editNewForm(form, data);
  return edited ? withForm(dialog, edited) : dialog;
}

function createSession(dialog: NewSessionDialog, ctx: NewSessionDialogContext): NewSessionDialog | undefined {
  const result = validateNewForm(dialog.form);
  if (!result.ok) return { ...dialog, actionFocus: undefined, optionsExpanded: dialog.optionsExpanded || !isRepoKey(result.state.focus), form: result.state };
  ctx.runAction(() => ctx.actions.createSession?.(submission(result.state)), "creating session...");
  return undefined;
}

function withForm(dialog: NewSessionDialog, form: NewFormState): NewSessionDialog {
  return { ...dialog, form, actionFocus: undefined };
}

function moveDialogFocus(dialog: NewSessionDialog, delta: number): NewSessionDialog {
  const order = newFormFields(dialog).map((field) => field.key);
  const current = order.indexOf(dialog.actionFocus ?? dialog.form.focus);
  const key = order[(current + delta + order.length) % order.length]!;
  return key in dialog.form.fields
    ? withForm(dialog, setFocus(dialog.form, key as NewFormState["focus"]))
    : { ...dialog, actionFocus: key as NewSessionAction };
}

function startRepoPicker(dialog: NewSessionDialog): NewSessionDialog | RepoPickerDialog {
  if (dialog.actionFocus || !isRepoKey(dialog.form.focus)) return dialog;
  const choices = dialog.form.fields[dialog.form.focus].suggestions ?? [];
  if (!choices.length) return dialog;
  return { kind: "repoPicker", draft: dialog, picker: createRepoPicker(choices), target: dialog.form.focus };
}

function handleRepoPickerInput(dialog: RepoPickerDialog, data: string): NewSessionDialog | RepoPickerDialog {
  if (matchesKey(data, Key.escape)) return dialog.draft;
  if (matchesKey(data, Key.down)) return { ...dialog, picker: moveRepoPickerSelection(dialog.picker, 1) };
  if (matchesKey(data, Key.up)) return { ...dialog, picker: moveRepoPickerSelection(dialog.picker, -1) };
  if (isEnterKey(data)) {
    const cwd = selectedRepoCwd(dialog.picker);
    return cwd ? withForm(dialog.draft, setRepoValue(dialog.draft.form, dialog.target, cwd)) : dialog;
  }
  const edited = editTextInput(data, dialog.picker.filter);
  return edited ? { ...dialog, picker: { ...dialog.picker, filter: edited, selected: 0 } } : dialog;
}

function action(key: NewSessionAction, label: string, value = "", hint?: string): FormField {
  return { key, label, value, hint, readonly: true };
}

function newFormFields(dialog: NewSessionDialog, width = 88): FormField[] {
  const { form } = dialog;
  const directories = form.order.filter(isRepoKey).map((key) => form.fields[key]);
  const values = directories.map((field) => field.value.trim()).filter(Boolean);
  const edited = dialog.favorite && JSON.stringify(values) !== JSON.stringify(dialog.favorite.cwds);
  const favoriteLabel = dialog.favorite ? `${dialog.favorite.name}${edited ? " · edited" : ""}` : "Choose…";
  const valueWidth = Math.max(0, Math.min(width - 2, 86) - 19);
  const mode = form.worktreeEnabled ? `branch: ${form.fields.branch?.value || "required"}` : "worktree off";
  const modeWidth = Math.min(visibleWidth(mode), Math.max(12, valueWidth - 7));
  const options = `${truncate(form.fields.group.value, Math.max(1, valueWidth - modeWidth - 3))} · ${truncate(mode, modeWidth)}`;
  return [
    { ...action("favorite", "Favorite", favoriteLabel, "enter choose · ctrl-f favorites"), frame: "picker" },
    ...directories.map((field) => ({ ...field, frame: "input" as const })),
    action("add", "+ Add directory", "", "enter add · ctrl-r"),
    action("options", `${dialog.optionsExpanded ? "▾" : "▸"} Options`, options, "space expand/collapse · ctrl-g group · ctrl-t worktree · ctrl-l branch"),
    ...(dialog.optionsExpanded ? form.order.filter((key) => !isRepoKey(key)).map((key) => ({ ...form.fields[key], frame: key === "worktree" ? undefined : "input" as const })) : []),
    { ...action("save", "Save favorite…", "", "enter name this set · ctrl-s"), section: "Actions" },
    action("create", "", "[ Create session ]"),
    action("cancel", "", "Cancel"),
  ];
}

function newFormFooter(dialog: NewSessionDialog): string {
  if (dialog.actionFocus) return "enter select · ^Y create · esc cancel";
  if (isRepoKey(dialog.form.focus)) return "enter next · ^Y create · esc cancel · ctrl-o choose directory";
  if (dialog.form.focus === "worktree") return "enter/space toggle · ^Y create · esc cancel";
  return "enter next · ^Y create · esc cancel";
}
