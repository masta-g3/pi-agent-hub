import { randomInt } from "node:crypto";
import { basename } from "node:path";
import { charLength } from "./text-input.js";
import {
  appendChar as appendFieldChar,
  backspace as backspaceField,
  backspaceFieldWord,
  createForm,
  deleteFieldWord,
  deleteForward as deleteFieldForward,
  moveFieldCursor,
  moveFieldCursorEnd,
  moveFieldCursorHome,
  moveFieldCursorWordLeft,
  moveFieldCursorWordRight,
  moveFocus as moveFormFocus,
  setFocus as setFormFocus,
  setValue,
  type FormField,
  type FormState,
} from "./form.js";

export type RepoFieldKey = `repo:${number}`;
export type FieldKey = RepoFieldKey | "group" | "title";

export interface Field extends FormField<FieldKey> {
  suggestions?: string[];
  cycleIndex?: number;
}

export interface NewFormState extends FormState<FieldKey, Field> {
  groupTouched: boolean;
  knownCwds: string[];
}

export interface NewFormContext {
  cwd: string;
  group?: string;
  knownCwds?: string[];
  additionalCwds?: string[];
  titleGenerator?: () => string;
}

const SESSION_ADJECTIVES = ["amber", "black", "blue", "bright", "calm", "crimson", "dark", "gold", "green", "quiet", "red", "silver", "swift", "violet", "white"] as const;
const SESSION_NOUNS = ["aleph", "atlas", "beacon", "cipher", "comet", "delta", "ember", "falcon", "lambda", "nova", "orbit", "pixel", "quartz", "vector", "zenith"] as const;

export function moveFocus(state: NewFormState, delta: number): NewFormState {
  return { ...state, focus: moveFormFocus(state, delta).focus };
}

export function setFocus(state: NewFormState, key: FieldKey): NewFormState {
  return { ...state, focus: setFormFocus(state, key).focus };
}

export function appendChar(state: NewFormState, char: string): NewFormState {
  return afterFocusedEdit(state, appendFieldChar(state, char) as NewFormState);
}

export function backspace(state: NewFormState): NewFormState {
  return afterFocusedEdit(state, backspaceField(state) as NewFormState);
}

export function deleteForward(state: NewFormState): NewFormState {
  return afterFocusedEdit(state, deleteFieldForward(state) as NewFormState);
}

export function moveCursor(state: NewFormState, delta: number): NewFormState {
  return moveFieldCursor(state, delta) as NewFormState;
}

export function moveCursorHome(state: NewFormState): NewFormState {
  return moveFieldCursorHome(state) as NewFormState;
}

export function moveCursorEnd(state: NewFormState): NewFormState {
  return moveFieldCursorEnd(state) as NewFormState;
}

export function moveCursorWordLeft(state: NewFormState): NewFormState {
  return moveFieldCursorWordLeft(state) as NewFormState;
}

export function moveCursorWordRight(state: NewFormState): NewFormState {
  return moveFieldCursorWordRight(state) as NewFormState;
}

export function backspaceWord(state: NewFormState): NewFormState {
  return afterFocusedEdit(state, backspaceFieldWord(state) as NewFormState);
}

export function deleteWord(state: NewFormState): NewFormState {
  return afterFocusedEdit(state, deleteFieldWord(state) as NewFormState);
}

export function createNewForm(ctx: NewFormContext): NewFormState {
  const cwd = ctx.cwd;
  const knownCwds = uniqueWithFirst(cwd, ctx.knownCwds ?? []);
  const contextGroup = ctx.group?.trim();
  const group = contextGroup || projectBasename(cwd) || "default";
  const title = ctx.titleGenerator?.() ?? randomSessionTitle();
  const fields = buildFields([cwd, ...(ctx.additionalCwds ?? [])], group, title, knownCwds);
  return {
    ...createForm<FieldKey, Field>(fields, "repo:0"),
    groupTouched: false,
    knownCwds,
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
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function submission(state: NewFormState): { cwd: string; group: string; title: string; additionalCwds?: string[] } {
  const repos = repoKeys(state).map((key) => state.fields[key].value.trim());
  const additionalCwds = repos.slice(1).filter(Boolean);
  return {
    cwd: repos[0] ?? "",
    group: state.fields.group.value.trim(),
    title: state.fields.title.value.trim(),
    ...(additionalCwds.length ? { additionalCwds } : {}),
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
  const title = state.fields.title.value;
  const fields = buildFields(repoValues, group, title, state.knownCwds);
  return {
    ...state,
    ...createForm<FieldKey, Field>(fields, focus),
  };
}

function buildFields(repoValues: string[], group: string, title: string, suggestions: string[]): Field[] {
  const repos = repoValues.length ? repoValues : [""];
  return [
    ...repos.map((value, index) => repoField(index, value, suggestions)),
    { key: "group" as const, label: "group", value: group },
    { key: "title" as const, label: "title", value: title },
  ];
}

function repoField(index: number, value: string, suggestions: string[]): Field {
  return {
    key: `repo:${index}`,
    label: index === 0 ? "★ primary" : "+ repo",
    value,
    hint: index === 0 ? cwdHint(suggestions.length) : undefined,
    suggestions,
    cycleIndex: matchSuggestionIndex(value, suggestions),
    section: index === 0 ? "repos" : undefined,
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

function randomSessionTitle(): string {
  const adjective = SESSION_ADJECTIVES[randomInt(SESSION_ADJECTIVES.length)];
  const noun = SESSION_NOUNS[randomInt(SESSION_NOUNS.length)];
  return `${adjective}-${noun}`;
}

function cwdHint(suggestionCount: number): string {
  if (suggestionCount > 1) return `default cwd · ctrl-n/p cycles ${suggestionCount} known cwds`;
  return "default cwd";
}
