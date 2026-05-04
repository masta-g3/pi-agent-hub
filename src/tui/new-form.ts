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

export type FieldKey = "cwd" | "group" | "title";

export interface Field extends FormField<FieldKey> {
  suggestions?: string[];
  cycleIndex?: number;
}

export interface NewFormState extends FormState<FieldKey, Field> {
  titleTouched: boolean;
}

export interface NewFormContext {
  cwd: string;
  knownCwds?: string[];
  groupForCwd?: (cwd: string) => string | undefined;
}

const ORDER: FieldKey[] = ["cwd", "group", "title"];

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
  const suggestions = uniqueWithFirst(cwd, ctx.knownCwds ?? []);
  const group = ctx.groupForCwd?.(cwd) ?? "default";
  return {
    ...createForm<FieldKey, Field>([
      {
        key: "cwd",
        label: "cwd",
        value: cwd,
        hint: cwdHint(suggestions.length),
        suggestions,
        cycleIndex: 0,
        truncate: "start",
      },
      { key: "group", label: "group", value: group, hint: "session group label" },
      { key: "title", label: "title", value: basename(cwd) || "session", hint: "defaults to cwd basename" },
    ], ORDER[0]),
    order: ORDER,
    titleTouched: false,
  };
}

export function cycleCwdSuggestion(state: NewFormState, delta: number): NewFormState {
  if (state.focus !== "cwd") return state;
  const cwd = state.fields.cwd;
  const suggestions = cwd.suggestions ?? [];
  if (suggestions.length === 0) return state;
  const current = cwd.cycleIndex ?? 0;
  const next = (current + delta + suggestions.length) % suggestions.length;
  const nextValue = suggestions[next] ?? cwd.value;
  return applyEdit({
    ...state,
    fields: { ...state.fields, cwd: { ...cwd, cycleIndex: next } },
  }, "cwd", nextValue);
}

export interface ValidationResult {
  ok: boolean;
  state: NewFormState;
}

export function validateNewForm(state: NewFormState): ValidationResult {
  const fields = { ...state.fields };
  let firstInvalid: FieldKey | undefined;
  for (const key of state.order) {
    const trimmed = fields[key].value.trim();
    if (!trimmed) {
      fields[key] = { ...fields[key], error: `${fields[key].label} is required` };
      firstInvalid ??= key;
    } else {
      fields[key] = { ...fields[key], error: undefined, value: trimmed, cursor: Math.min(fields[key].cursor ?? charLength(trimmed), charLength(trimmed)) };
    }
  }
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function submission(state: NewFormState): { cwd: string; group: string; title: string } {
  return {
    cwd: state.fields.cwd.value.trim(),
    group: state.fields.group.value.trim(),
    title: state.fields.title.value.trim(),
  };
}

function applyEdit(state: NewFormState, key: FieldKey, nextValue: string): NewFormState {
  return afterFieldEdit(state, setValue(state, key, nextValue) as NewFormState, key);
}

function afterFocusedEdit(previous: NewFormState, next: NewFormState): NewFormState {
  return afterFieldEdit(previous, next, previous.focus);
}

function afterFieldEdit(previous: NewFormState, next: NewFormState, key: FieldKey): NewFormState {
  const fields = { ...next.fields };
  if (key === "cwd") {
    const cwd = fields.cwd;
    fields.cwd = { ...cwd, cycleIndex: matchSuggestionIndex(cwd.value, cwd.suggestions) };
  }
  let titleTouched = previous.titleTouched;
  if (key === "title") titleTouched = true;
  else if (key === "cwd" && !titleTouched) {
    const title = basename(fields.cwd.value) || fields.title.value;
    fields.title = { ...fields.title, value: title, cursor: charLength(title) };
  }
  return { ...next, fields, titleTouched };
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

function cwdHint(suggestionCount: number): string {
  if (suggestionCount > 1) return `current dir · ctrl-n cycles ${suggestionCount} known cwds`;
  return "current dir";
}
