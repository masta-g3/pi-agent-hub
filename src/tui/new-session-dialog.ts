import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { NewSessionDialogContext } from "./dialog.js";
import { editTextInput, isEnterKey } from "./text-input.js";
import { renderForm } from "./layout.js";
import { createRepoPicker, moveRepoPickerSelection, renderRepoPicker, selectedRepoCwd, type RepoPickerState } from "./repo-picker.js";
import {
  addRepo,
  createNewForm,
  cycleCwdSuggestion,
  editNewForm,
  isRepoKey,
  moveFocus,
  removeFocusedRepo,
  setRepoValue,
  submission,
  toggleWorktree,
  validateNewForm,
  type NewFormState,
  type RepoFieldKey,
} from "./new-form.js";

export interface NewSessionDialog {
  kind: "new";
  form: NewFormState;
}

export interface RepoPickerDialog {
  kind: "repoPicker";
  form: NewFormState;
  picker: RepoPickerState;
  target: RepoFieldKey;
}

export function openNewSessionDialog(ctx: NewSessionDialogContext): NewSessionDialog {
  const formCtx = ctx.actions.newFormContext?.() ?? { cwd: process.cwd() };
  return { kind: "new", form: createNewForm(formCtx) };
}

export function handleNewSessionInput(dialog: NewSessionDialog | RepoPickerDialog, data: string, ctx: NewSessionDialogContext): NewSessionDialog | RepoPickerDialog | undefined {
  return dialog.kind === "new" ? handleNewFormInput(dialog, data, ctx) : handleRepoPickerInput(dialog, data);
}

export function renderNewSessionDialog(dialog: NewSessionDialog | RepoPickerDialog, width: number, ctx: NewSessionDialogContext): string[] {
  if (dialog.kind === "repoPicker") return renderRepoPicker(dialog.picker, width, ctx.theme);
  return renderForm({
    title: "New session",
    fields: newFormFields(dialog.form),
    focus: dialog.form.focus,
    footer: newFormFooter(dialog.form),
    narrowFooter: "tab · ctrl-r · enter · esc",
  }, width, ctx.theme);
}

function handleNewFormInput(dialog: NewSessionDialog, data: string, ctx: NewSessionDialogContext): NewSessionDialog | RepoPickerDialog | undefined {
  const form = dialog.form;
  if (matchesKey(data, Key.escape)) {
    ctx.setMessage(undefined);
    return undefined;
  }
  if (isEnterKey(data)) {
    const result = validateNewForm(form);
    if (!result.ok) return { ...dialog, form: result.state };
    ctx.runAction(() => ctx.actions.createSession?.(submission(result.state)), "creating session...");
    return undefined;
  }
  if (matchesKey(data, Key.ctrl("t")) || (form.focus === "worktree" && data === " ")) {
    ctx.setMessage(undefined);
    return { ...dialog, form: toggleWorktree(form) };
  }
  if (matchesKey(data, Key.ctrl("r"))) return { ...dialog, form: addRepo(form) };
  if (matchesKey(data, Key.ctrl("x"))) return { ...dialog, form: removeFocusedRepo(form) };
  if (matchesKey(data, Key.ctrl("o"))) return startRepoPicker(dialog);
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) return { ...dialog, form: moveFocus(form, 1) };
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) return { ...dialog, form: moveFocus(form, -1) };
  if (matchesKey(data, Key.ctrl("n"))) return { ...dialog, form: cycleCwdSuggestion(form, 1) };
  if (matchesKey(data, Key.ctrl("p"))) return { ...dialog, form: cycleCwdSuggestion(form, -1) };
  const edited = editNewForm(form, data);
  return edited ? { ...dialog, form: edited } : dialog;
}

function startRepoPicker(dialog: NewSessionDialog): NewSessionDialog | RepoPickerDialog {
  if (!isRepoKey(dialog.form.focus)) return dialog;
  const choices = dialog.form.fields[dialog.form.focus].suggestions ?? [];
  if (!choices.length) return dialog;
  return { kind: "repoPicker", form: dialog.form, picker: createRepoPicker(choices), target: dialog.form.focus };
}

function handleRepoPickerInput(dialog: RepoPickerDialog, data: string): NewSessionDialog | RepoPickerDialog {
  if (matchesKey(data, Key.escape)) return { kind: "new", form: dialog.form };
  if (matchesKey(data, Key.down)) return { ...dialog, picker: moveRepoPickerSelection(dialog.picker, 1) };
  if (matchesKey(data, Key.up)) return { ...dialog, picker: moveRepoPickerSelection(dialog.picker, -1) };
  if (isEnterKey(data)) return applyRepoPickerSelection(dialog);
  const edited = editTextInput(data, dialog.picker.filter);
  return edited ? { ...dialog, picker: { ...dialog.picker, filter: edited, selected: 0 } } : dialog;
}

function applyRepoPickerSelection(dialog: RepoPickerDialog): NewSessionDialog | RepoPickerDialog {
  const cwd = selectedRepoCwd(dialog.picker);
  if (!cwd) return dialog;
  return { kind: "new", form: setRepoValue(dialog.form, dialog.target, cwd) };
}

function newFormFields(state: NewFormState) {
  return state.order.map((key) => state.fields[key]);
}

function newFormFooter(state: NewFormState): string {
  const focus = state.fields[state.focus];
  const parts = ["tab/↑↓ move"];
  if (state.focus.startsWith("repo:")) {
    if ((focus.suggestions?.length ?? 0) > 0) parts.push("ctrl-o choose repo");
    parts.push("ctrl-r add repo");
    if (state.focus !== "repo:0") parts.push("ctrl-x remove");
  }
  if (state.focus === "worktree") parts.push("space toggle");
  parts.push("ctrl-t worktree", "enter create", "esc cancel");
  return parts.join(" · ");
}
