import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { SessionFavorite, SessionFavorites } from "../core/session-favorites.js";
import { applyFavorite, favoriteCwds } from "./new-form.js";
import type { NewSessionDialog } from "./new-session-dialog.js";
import type { NewSessionDialogContext } from "./dialog.js";
import { errorMessage, isPromise } from "./dialog.js";
import { createForm, editField, type FormState } from "./form.js";
import { renderCursorValue, renderDialog, renderForm } from "./layout.js";
import { createTextInput, editTextInput, isEnterKey, type TextInputState } from "./text-input.js";
import { styleToken } from "./theme.js";

export type FavoritesDialogMode = "picker" | "save" | "rename" | "update" | "remove";
type NameForm = FormState<"name">;

export interface FavoritesDialog {
  kind: "sessionFavorites";
  draft: NewSessionDialog;
  mode: FavoritesDialogMode;
  search: TextInputState;
  selected?: string;
  favorites?: SessionFavorites;
  edit?: NameForm;
  loading?: boolean;
  pending?: boolean;
  error?: string;
}

export function openFavoritesDialog(
  draft: NewSessionDialog,
  ctx: NewSessionDialogContext,
  mode: "picker" | "save" = "picker",
): FavoritesDialog {
  const dialog: FavoritesDialog = {
    kind: "sessionFavorites",
    draft,
    mode,
    search: createTextInput(),
    ...(mode === "save" ? { edit: nameForm(draft.form.fields.group.value) } : {}),
    loading: true,
  };
  return retryLoad(dialog, ctx);
}

function retryLoad(dialog: FavoritesDialog, ctx: NewSessionDialogContext): FavoritesDialog {
  const loading: FavoritesDialog = { ...dialog, loading: true, error: undefined };
  ctx.setDialog(loading);
  const load = ctx.actions.favorites?.load;
  if (!load) return { ...loading, loading: false, error: "session favorites unavailable" };
  try {
    const result = load();
    if (!isPromise<SessionFavorites>(result)) return loadedDialog(loading, result);
    void result.then((favorites) => {
      if (ctx.dialog() !== loading) return;
      ctx.setDialog(loadedDialog(loading, favorites));
    }).catch((error: unknown) => {
      if (ctx.dialog() !== loading) return;
      ctx.setDialog({ ...loading, loading: false, error: errorMessage(error) });
    });
    return loading;
  } catch (error) {
    return { ...loading, loading: false, error: errorMessage(error) };
  }
}

export function handleFavoritesInput(
  dialog: FavoritesDialog,
  data: string,
  ctx: NewSessionDialogContext,
): FavoritesDialog | NewSessionDialog {
  if (matchesKey(data, Key.escape)) {
    if (dialog.pending || dialog.loading) return dialog.draft;
    if (dialog.mode !== "picker") return pickerDialog(dialog);
    return dialog.draft;
  }
  if (dialog.pending || dialog.loading) return dialog;
  if (!dialog.favorites) return isEnterKey(data) ? retryLoad(dialog, ctx) : dialog;
  if (dialog.mode === "picker") return handlePickerInput(dialog, data, ctx);
  if (dialog.mode === "save" || dialog.mode === "rename") return handleNameInput(dialog, data, ctx);
  if (isEnterKey(data)) return submitMutation(dialog, ctx);
  return dialog;
}

export function renderFavoritesDialog(dialog: FavoritesDialog, width: number, ctx: NewSessionDialogContext): string[] {
  if (dialog.mode === "picker") return renderPicker(dialog, width, ctx);
  if (dialog.mode === "save" || dialog.mode === "rename") return renderName(dialog, width, ctx);
  return renderConfirmation(dialog, width, ctx);
}

function handlePickerInput(dialog: FavoritesDialog, data: string, ctx: NewSessionDialogContext): FavoritesDialog | NewSessionDialog {
  if (matchesKey(data, Key.ctrl("s"))) {
    return { ...dialog, mode: "save", edit: nameForm(dialog.draft.form.fields.group.value), error: undefined };
  }
  const selected = selectedFavorite(dialog);
  if (matchesKey(data, Key.ctrl("u"))) return selected ? { ...dialog, mode: "update", error: undefined } : dialog;
  if (matchesKey(data, Key.ctrl("r"))) {
    return selected ? { ...dialog, mode: "rename", edit: nameForm(selected.name), error: undefined } : dialog;
  }
  if (matchesKey(data, Key.ctrl("x"))) return selected ? { ...dialog, mode: "remove", error: undefined } : dialog;
  if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
    const choices = filteredFavorites(dialog);
    if (!choices.length) return dialog;
    const index = Math.max(0, choices.findIndex((favorite) => favorite.id === dialog.selected));
    const delta = matchesKey(data, Key.down) ? 1 : -1;
    return { ...dialog, selected: choices[(index + delta + choices.length) % choices.length]!.id, error: undefined };
  }
  if (isEnterKey(data)) {
    if (!selected) return dialog;
    const favorite = copyFavorite(selected);
    return {
      ...dialog.draft,
      form: applyFavorite(dialog.draft.form, favorite),
      favorite,
      actionFocus: undefined,
    };
  }
  const search = editTextInput(data, dialog.search);
  if (!search) return dialog;
  const next = { ...dialog, search, error: undefined };
  return { ...next, selected: filteredFavorites(next)[0]?.id };
}

function handleNameInput(dialog: FavoritesDialog, data: string, ctx: NewSessionDialogContext): FavoritesDialog {
  if (isEnterKey(data)) return submitMutation(dialog, ctx);
  if (!dialog.edit) return dialog;
  const edit = editField(dialog.edit, data);
  return edit ? { ...dialog, edit, error: undefined } : dialog;
}

function submitMutation(dialog: FavoritesDialog, ctx: NewSessionDialogContext): FavoritesDialog {
  if (!dialog.favorites) return { ...dialog, error: dialog.error ?? "session favorites unavailable" };
  const actions = ctx.actions.favorites;
  const selected = selectedFavorite(dialog);
  let invoke: (() => SessionFavorites | Promise<SessionFavorites>) | undefined;
  if (dialog.mode === "save") {
    const name = dialog.edit?.fields.name.value.trim() ?? "";
    if (!name) return nameError(dialog, "Favorite name is required");
    if (actions?.save) invoke = () => actions.save!(name, favoriteCwds(dialog.draft.form));
  } else if (dialog.mode === "rename") {
    const name = dialog.edit?.fields.name.value.trim() ?? "";
    if (!name) return nameError(dialog, "Favorite name is required");
    if (selected && actions?.rename) invoke = () => actions.rename!(selected.id, name);
  } else if (dialog.mode === "update") {
    if (selected && actions?.update) invoke = () => actions.update!(selected.id, favoriteCwds(dialog.draft.form));
  } else if (dialog.mode === "remove") {
    if (selected && actions?.remove) invoke = () => actions.remove!(selected.id);
  }
  if (!invoke) return { ...dialog, error: "session favorites unavailable" };

  const pending: FavoritesDialog = { ...dialog, pending: true, error: undefined };
  ctx.setDialog(pending);
  try {
    const result = invoke();
    if (!isPromise<SessionFavorites>(result)) return mutationComplete(pending, result);
    void result.then((favorites) => {
      if (ctx.dialog() !== pending) return;
      ctx.setDialog(mutationComplete(pending, favorites));
    }).catch((error: unknown) => {
      if (ctx.dialog() !== pending) return;
      ctx.setDialog({ ...pending, pending: false, error: errorMessage(error) });
    });
    return pending;
  } catch (error) {
    return { ...pending, pending: false, error: errorMessage(error) };
  }
}

function renderPicker(dialog: FavoritesDialog, width: number, ctx: NewSessionDialogContext): string[] {
  const choices = filteredFavorites(dialog);
  const selected = selectedFavorite(dialog);
  const height = ctx.actions.terminalRows?.() ?? 18;
  const rowBudget = Math.max(3, height - 4);
  const footers = dialog.loading ? ["loading… · esc back"] : !dialog.favorites
    ? ["enter retry · esc back"]
    : ["^S save ^U update ^R rename ^X remove", "↑↓ select · enter apply · esc back"];
  const fixedRows = 1 + footers.length + (dialog.error ? 1 : 0);
  const listLimit = Math.max(1, Math.min(8, rowBudget - fixedRows - (selected ? 2 : 0)));
  const selectedIndex = Math.max(0, choices.findIndex((favorite) => favorite.id === dialog.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(listLimit / 2), choices.length - listLimit));
  const visible = choices.slice(start, start + listLimit);
  const itemLines = visible.map((favorite) => {
    const marker = favorite.id === dialog.selected ? "▎" : " ";
    const line = `${marker} ${favorite.name}  ·  ${favorite.cwds.length} ${favorite.cwds.length === 1 ? "directory" : "directories"}`;
    return favorite.id === dialog.selected && ctx.theme ? styleToken(ctx.theme, "accent", line) : line;
  });
  const state = dialog.loading ? ["loading favorites..."] : choices.length ? itemLines : [dialog.search.value ? "No matching favorites." : "No favorites saved."];
  const usedRows = fixedRows + state.length;
  const detailBudget = Math.max(0, rowBudget - usedRows);
  const allDetails = selected ? [`Primary  ${selected.cwds[0] ?? ""}`, ...selected.cwds.slice(1).map((cwd) => `Extra    ${cwd}`)] : [];
  const details = allDetails.slice(0, detailBudget);
  if (allDetails.length > details.length && details.length) details[details.length - 1] = `         +${allDetails.length - details.length + 1} more`;
  return renderDialog("Session favorites", [
    `Search  ${renderCursorValue(dialog.search.value, dialog.search.cursor, Math.min(width - 2, 86) - 8, "start")}`,
    ...state,
    ...details,
    ...(dialog.error ? [errorLine(dialog.error, ctx)] : []),
    ...footers,
  ], width, ctx.theme);
}

function renderName(dialog: FavoritesDialog, width: number, ctx: NewSessionDialogContext): string[] {
  const name = dialog.edit?.fields.name;
  const title = dialog.mode === "save" ? "Save favorite" : "Rename favorite";
  const paths = dialog.mode === "save" ? displayDraftCwds(dialog) : selectedFavorite(dialog)?.cwds ?? [];
  const details = paths.length ? paths : ["No directories."];
  return renderForm({
    title,
    fields: [
      { key: "name", label: "Name", value: name?.value ?? "", cursor: name?.cursor, error: name?.error ?? dialog.error },
      ...details.map((path, index) => ({
        key: `path:${index}`,
        label: paths.length ? (index === 0 ? "Primary" : "Extra") : "Directory",
        value: path,
        readonly: true,
        truncate: "start" as const,
      })),
    ],
    focus: "name",
    compact: true,
    height: ctx.actions.terminalRows?.(),
    footer: dialog.loading ? "loading… · Esc back" : !dialog.favorites ? "Enter retry · Esc back" : dialog.pending ? (dialog.mode === "save" ? "saving..." : "renaming...") : "Enter confirm · Esc back",
  }, width, ctx.theme);
}

function renderConfirmation(dialog: FavoritesDialog, width: number, ctx: NewSessionDialogContext): string[] {
  const selected = selectedFavorite(dialog);
  const update = dialog.mode === "update";
  const paths = update ? displayDraftCwds(dialog) : selected?.cwds ?? [];
  const height = ctx.actions.terminalRows?.() ?? 18;
  const footer = dialog.pending ? (update ? "updating..." : "removing...") : "Enter confirm · Esc back";
  const leading = update
    ? [`Favorite  ${selected?.name ?? "none"}`, `Replace with ${paths.length} directories:`]
    : [`Favorite  ${selected?.name ?? "none"}`, "Remove this saved favorite?", "The session draft and directories are unchanged."];
  const availablePaths = Math.max(0, height - 4 - leading.length - (dialog.error ? 1 : 0) - 1);
  const details = update ? pathLines(paths).slice(0, availablePaths) : [];
  if (update && paths.length > details.length && details.length) details[details.length - 1] = `+${paths.length - details.length + 1} more directories`;
  return renderDialog(update ? "Update favorite" : "Remove favorite", [
    ...leading,
    ...details,
    ...(dialog.error ? [errorLine(dialog.error, ctx)] : []),
    footer,
  ], width, ctx.theme);
}

function loadedDialog(dialog: FavoritesDialog, favorites: SessionFavorites): FavoritesDialog {
  const next = { ...dialog, favorites: copyFavorites(favorites), loading: false, error: undefined };
  return { ...next, selected: filteredFavorites(next)[0]?.id };
}

function mutationComplete(dialog: FavoritesDialog, favorites: SessionFavorites): FavoritesDialog {
  const previousId = dialog.mode === "save"
    ? favorites.favorites.find((favorite) => favorite.name === dialog.edit?.fields.name.value.trim())?.id
    : dialog.selected;
  const picker: FavoritesDialog = {
    ...dialog,
    mode: "picker",
    favorites: copyFavorites(favorites),
    edit: undefined,
    pending: false,
    error: undefined,
  };
  const choices = filteredFavorites(picker);
  return { ...picker, selected: choices.some((favorite) => favorite.id === previousId) ? previousId : choices[0]?.id };
}

function pickerDialog(dialog: FavoritesDialog): FavoritesDialog {
  return { ...dialog, mode: "picker", edit: undefined, pending: false, error: undefined };
}

function selectedFavorite(dialog: FavoritesDialog): SessionFavorite | undefined {
  return dialog.favorites?.favorites.find((favorite) => favorite.id === dialog.selected);
}

function filteredFavorites(dialog: FavoritesDialog): SessionFavorite[] {
  const query = dialog.search.value.trim().toLocaleLowerCase();
  return [...(dialog.favorites?.favorites ?? [])]
    .filter((favorite) => !query || favorite.name.toLocaleLowerCase().includes(query) || favorite.cwds.some((cwd) => cwd.toLocaleLowerCase().includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function nameForm(value: string): NameForm {
  return createForm([{ key: "name" as const, label: "name", value }], "name");
}

function nameError(dialog: FavoritesDialog, error: string): FavoritesDialog {
  if (!dialog.edit) return { ...dialog, error };
  return { ...dialog, edit: { ...dialog.edit, fields: { ...dialog.edit.fields, name: { ...dialog.edit.fields.name, error } } } };
}

function displayDraftCwds(dialog: FavoritesDialog): string[] {
  return dialog.draft.form.order
    .filter((key) => key.startsWith("repo:"))
    .map((key) => dialog.draft.form.fields[key].value.trim())
    .filter((value, index) => index === 0 || Boolean(value));
}

function pathLines(cwds: string[]): string[] {
  return cwds.length ? cwds.map((cwd, index) => `${index === 0 ? "Primary" : "Extra  "}  ${cwd}`) : ["No directories."];
}

function errorLine(error: string, ctx: NewSessionDialogContext): string {
  return ctx.theme ? styleToken(ctx.theme, "error", error) : error;
}

function copyFavorite(favorite: SessionFavorite): SessionFavorite {
  return { ...favorite, cwds: [...favorite.cwds] };
}

function copyFavorites(favorites: SessionFavorites): SessionFavorites {
  return { ...favorites, favorites: favorites.favorites.map(copyFavorite) };
}
