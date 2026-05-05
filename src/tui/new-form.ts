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

export type FieldKey = "cwd" | "extraCwds" | "group" | "title";

export interface Field extends FormField<FieldKey> {
  suggestions?: string[];
  cycleIndex?: number;
}

export interface NewFormState extends FormState<FieldKey, Field> {
  groupTouched: boolean;
}

export interface NewFormContext {
  cwd: string;
  group?: string;
  knownCwds?: string[];
  titleGenerator?: () => string;
}

const ORDER: FieldKey[] = ["cwd", "group", "title", "extraCwds"];
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
  const suggestions = uniqueWithFirst(cwd, ctx.knownCwds ?? []);
  const contextGroup = ctx.group?.trim();
  const group = contextGroup || basename(cwd) || "default";
  const title = ctx.titleGenerator?.() ?? randomSessionTitle();
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
      { key: "extraCwds", label: "extra cwd(s)", value: "", hint: "optional · comma-separated · symlinked into one workspace", truncate: "start" },
      { key: "group", label: "group", value: group, hint: contextGroup ? "selected session group" : "defaults to cwd basename" },
      { key: "title", label: "title", value: title, hint: "random two-word slug" },
    ], ORDER[0]),
    order: ORDER,
    groupTouched: false,
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
    if (!trimmed && key !== "extraCwds") {
      fields[key] = { ...fields[key], error: `${fields[key].label} is required` };
      firstInvalid ??= key;
    } else {
      fields[key] = { ...fields[key], error: undefined, value: trimmed, cursor: Math.min(fields[key].cursor ?? charLength(trimmed), charLength(trimmed)) };
    }
  }
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function submission(state: NewFormState): { cwd: string; group: string; title: string; additionalCwds?: string[] } {
  const additionalCwds = parseAdditionalCwds(state.fields.extraCwds.value);
  return {
    cwd: state.fields.cwd.value.trim(),
    group: state.fields.group.value.trim(),
    title: state.fields.title.value.trim(),
    ...(additionalCwds.length ? { additionalCwds } : {}),
  };
}

export function parseAdditionalCwds(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
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
  let groupTouched = previous.groupTouched;
  if (key === "group") groupTouched = true;
  else if (key === "cwd" && !groupTouched) {
    const group = basename(fields.cwd.value) || "default";
    fields.group = { ...fields.group, value: group, cursor: charLength(group) };
  }
  return { ...next, fields, groupTouched };
}

export function randomSessionTitle(): string {
  return `${randomItem(SESSION_ADJECTIVES)}-${randomItem(SESSION_NOUNS)}`;
}

function randomItem(items: readonly string[]): string {
  return items[randomInt(items.length)] ?? items[0] ?? "session";
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
  if (suggestionCount > 1) return `default cwd · ctrl-n cycles ${suggestionCount} known cwds`;
  return "default cwd";
}
