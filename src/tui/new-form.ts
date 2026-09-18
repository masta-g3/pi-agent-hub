import { basename } from "node:path";
import { normalizeGroup } from "../core/registry.js";
import type { SessionFavorite } from "../core/session-favorites.js";
import { charLength, editKey } from "./text-input.js";
import { createForm, editField, moveFocus as moveFormFocus, setFocus as setFormFocus, setValue, type FormField, type FormState } from "./form.js";

export type RepoFieldKey = `repo:${number}`;
export type FieldKey = RepoFieldKey | "worktree" | "branch" | "group";

export interface Field extends FormField<FieldKey> {
  suggestions?: string[];
  readonly?: boolean;
  cycleIndex?: number;
}

export interface NewFormState extends FormState<FieldKey, Field> {
  groupTouched: boolean;
  knownCwds: string[];
  worktreeEnabled: boolean;
}

export interface NewFormContext {
  cwd: string;
  group?: string;
  knownCwds?: string[];
  additionalCwds?: string[];
  worktreeDefault?: boolean;
}

export function moveFocus(state: NewFormState, delta: number): NewFormState {
  return { ...state, focus: moveFormFocus(state, delta).focus };
}

export function setFocus(state: NewFormState, key: FieldKey): NewFormState {
  return { ...state, focus: setFormFocus(state, key).focus };
}

export function editNewForm(state: NewFormState, data: string): NewFormState | undefined {
  if (state.focus === "worktree") return undefined;
  const key = editKey(data);
  if (!key) return undefined;
  const edited = editField(state, data) as NewFormState | undefined;
  if (!edited) return undefined;
  return key.kind === "edit" ? afterFocusedEdit(state, edited) : edited;
}

export function createNewForm(ctx: NewFormContext): NewFormState {
  const cwd = ctx.cwd;
  const knownCwds = uniqueWithFirst(cwd, ctx.knownCwds ?? []);
  const contextGroup = ctx.group?.trim();
  const group = contextGroup || projectBasename(cwd) || "default";
  const worktreeEnabled = ctx.worktreeDefault ?? false;
  const fields = buildFields([cwd, ...(ctx.additionalCwds ?? [])], group, knownCwds, worktreeEnabled);
  return {
    ...createForm<FieldKey, Field>(fields, "repo:0"),
    groupTouched: false,
    knownCwds,
    worktreeEnabled,
  };
}

export function addRepo(state: NewFormState): NewFormState {
  const values = repoKeys(state).map((key) => state.fields[key].value);
  const focusIndex = isRepoKey(state.focus) ? repoIndex(state.focus) : values.length - 1;
  const insertAt = Math.max(1, Math.min(focusIndex + 1, values.length));
  const nextValues = [...values.slice(0, insertAt), "", ...values.slice(insertAt)];
  return rebuildRepoFields(state, nextValues, `repo:${insertAt}`);
}

export function removeFocusedRepo(state: NewFormState): NewFormState {
  if (!isRepoKey(state.focus) || isPrimaryRepoKey(state.focus)) return state;
  const removedIndex = repoIndex(state.focus);
  const values = repoKeys(state).map((key) => state.fields[key].value).filter((_, index) => index !== removedIndex);
  const focusIndex = Math.max(0, Math.min(removedIndex - 1, values.length - 1));
  return rebuildRepoFields(state, values, `repo:${focusIndex}`);
}

export function cycleCwdSuggestion(state: NewFormState, delta: number): NewFormState {
  if (!isRepoKey(state.focus)) return state;
  const field = state.fields[state.focus];
  const suggestions = field.suggestions ?? [];
  if (suggestions.length === 0) return state;
  const current = field.cycleIndex ?? (delta > 0 ? -1 : 0);
  const next = (current + delta + suggestions.length) % suggestions.length;
  const nextValue = suggestions[next] ?? field.value;
  return applyEdit({
    ...state,
    fields: { ...state.fields, [state.focus]: { ...field, cycleIndex: next } },
  }, state.focus, nextValue);
}

export function setRepoValue(state: NewFormState, key: RepoFieldKey, cwd: string): NewFormState {
  return applyEdit(state, key, cwd);
}

export function toggleWorktree(state: NewFormState): NewFormState {
  const repos = repoKeys(state).map((key) => state.fields[key].value);
  const branch = state.fields.branch?.value ?? "";
  const nextEnabled = !state.worktreeEnabled;
  const focus = state.focus === "worktree" ? "worktree" : nextEnabled ? "branch" : "worktree";
  return {
    ...state,
    ...createForm<FieldKey, Field>(buildFields(repos, state.fields.group.value, state.knownCwds, nextEnabled, branch), focus),
    worktreeEnabled: nextEnabled,
  };
}

export interface ValidationResult {
  ok: boolean;
  state: NewFormState;
}

export function validateNewForm(state: NewFormState): ValidationResult {
  const fields = { ...state.fields };
  let firstInvalid: FieldKey | undefined;
  for (const key of state.order) {
    const field = fields[key];
    const trimmed = field.value.trim();
    if (!trimmed && !isOptionalRepoKey(key)) {
      fields[key] = { ...field, error: `${field.label} is required` };
      firstInvalid ??= key;
    } else {
      fields[key] = { ...field, error: undefined, value: trimmed, cursor: Math.min(field.cursor ?? charLength(trimmed), charLength(trimmed)) };
    }
  }
  if (!fields.group.error) {
    try {
      normalizeGroup(fields.group.value);
    } catch (error) {
      fields.group = { ...fields.group, error: (error as Error).message };
      firstInvalid ??= "group";
    }
  }
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function favoriteCwds(state: NewFormState): string[] {
  const values = repoKeys(state).map((key) => state.fields[key].value.trim());
  if (!values[0]) throw new Error("Primary directory is required");
  return [values[0], ...values.slice(1).filter(Boolean)];
}

export function applyFavorite(state: NewFormState, favorite: SessionFavorite): NewFormState {
  const next = rebuildRepoFields(state, [...favorite.cwds], "repo:0");
  return { ...next, groupTouched: true, fields: { ...next.fields, group: { ...next.fields.group, value: favorite.name, cursor: charLength(favorite.name), error: undefined } } };
}

export interface NewFormSubmission {
  cwd: string;
  group: string;
  additionalCwds?: string[];
  worktree?: { branch: string };
}

export function submission(state: NewFormState): NewFormSubmission {
  const repos = repoKeys(state).map((key) => state.fields[key].value.trim());
  const additionalCwds = repos.slice(1).filter(Boolean);
  return {
    cwd: repos[0] ?? "",
    group: state.fields.group.value.trim(),
    ...(additionalCwds.length ? { additionalCwds } : {}),
    ...(state.worktreeEnabled ? { worktree: { branch: state.fields.branch.value.trim() } } : {}),
  };
}

export function isRepoKey(key: FieldKey): key is RepoFieldKey {
  return key.startsWith("repo:");
}

export function isPrimaryRepoKey(key: FieldKey): boolean {
  return key === "repo:0";
}

function applyEdit(state: NewFormState, key: FieldKey, nextValue: string): NewFormState {
  return afterFieldEdit(state, setValue(state, key, nextValue) as NewFormState, key);
}

function afterFocusedEdit(previous: NewFormState, next: NewFormState): NewFormState {
  return afterFieldEdit(previous, next, previous.focus);
}

function afterFieldEdit(previous: NewFormState, next: NewFormState, key: FieldKey): NewFormState {
  const fields = { ...next.fields };
  if (isRepoKey(key)) {
    const field = fields[key];
    fields[key] = { ...field, cycleIndex: matchSuggestionIndex(field.value, field.suggestions) };
  }

  let groupTouched = previous.groupTouched;
  if (key === "group") groupTouched = true;

  if (isPrimaryRepoKey(key) && !groupTouched) {
    const group = projectBasename(fields["repo:0"].value) || "default";
    fields.group = { ...fields.group, value: group, cursor: charLength(group) };
  }

  return { ...next, fields, groupTouched };
}

function rebuildRepoFields(state: NewFormState, repoValues: string[], focus: FieldKey): NewFormState {
  const group = state.fields.group.value;
  const branch = state.fields.branch?.value ?? "";
  const fields = buildFields(repoValues, group, state.knownCwds, state.worktreeEnabled, branch);
  return {
    ...state,
    ...createForm<FieldKey, Field>(fields, focus),
  };
}

function buildFields(repoValues: string[], group: string, suggestions: string[], worktreeEnabled: boolean, branch = ""): Field[] {
  const repos = repoValues.length ? repoValues : [""];
  const repoCount = repos.filter((repo) => repo.trim()).length;
  return [
    ...repos.map((value, index) => repoField(index, value, suggestions)),
    {
      key: "worktree" as const,
      label: "worktree",
      value: worktreeEnabled ? `[x] on${repoCount > 1 ? ` · ${repoCount} repos` : ""}` : "[ ] off",
      hint: "space toggle · create an isolated Git branch",
      readonly: true,
    },
    ...(worktreeEnabled ? [{ key: "branch" as const, label: "branch", value: branch, hint: repos.length > 1 ? "same new branch in every repo" : "new local branch" }] : []),
    { key: "group" as const, label: "group", value: group, hint: "existing or new label" },
  ];
}

function repoField(index: number, value: string, suggestions: string[]): Field {
  return {
    key: `repo:${index}`,
    label: index === 0 ? "Primary" : "Additional",
    value,
    hint: index === 0 ? "Project Skills/MCP use this directory · ctrl-o choose" : "ctrl-o choose · ctrl-x remove",
    suggestions,
    cycleIndex: matchSuggestionIndex(value, suggestions),
    truncate: "start",
  };
}

function repoKeys(state: NewFormState): RepoFieldKey[] {
  return state.order.filter(isRepoKey);
}

function repoIndex(key: RepoFieldKey): number {
  return Number(key.slice("repo:".length));
}

function isOptionalRepoKey(key: FieldKey): boolean {
  return isRepoKey(key) && !isPrimaryRepoKey(key);
}

function matchSuggestionIndex(value: string, suggestions: string[] | undefined): number | undefined {
  if (!suggestions) return undefined;
  const idx = suggestions.indexOf(value);
  return idx >= 0 ? idx : undefined;
}

function uniqueWithFirst(first: string, items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [first, ...items]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function projectBasename(path: string): string {
  return basename(path.trim());
}
