import { backspaceText, backspaceWord, charLength, createTextInput, deleteText, deleteWord, insertText, moveCursor, moveCursorEnd, moveCursorHome, moveCursorWordLeft, moveCursorWordRight } from "./text-input.js";

export interface FormField<K extends string = string> {
  key: K;
  label: string;
  value: string;
  cursor?: number;
  hint?: string;
  error?: string;
  truncate?: "end" | "start";
}

export interface FormState<K extends string = string, F extends FormField<K> = FormField<K>> {
  fields: Record<K, F>;
  focus: K;
  order: K[];
}

export interface RequiredValidationResult<K extends string = string, F extends FormField<K> = FormField<K>> {
  ok: boolean;
  state: FormState<K, F>;
}

export function createForm<K extends string, F extends FormField<K> = FormField<K>>(fields: F[], focus?: K): FormState<K, F> {
  const order = fields.map((field) => field.key);
  return {
    fields: Object.fromEntries(fields.map((field) => [field.key, normalizeField(field)])) as Record<K, F>,
    focus: focus ?? order[0]!,
    order,
  };
}

export function moveFocus<K extends string, F extends FormField<K>>(state: FormState<K, F>, delta: number): FormState<K, F> {
  const idx = state.order.indexOf(state.focus);
  const next = state.order[(idx + delta + state.order.length) % state.order.length];
  return { ...state, focus: next ?? state.focus };
}

export function setFocus<K extends string, F extends FormField<K>>(state: FormState<K, F>, key: K): FormState<K, F> {
  return { ...state, focus: key };
}

export function appendChar<K extends string, F extends FormField<K>>(state: FormState<K, F>, char: string): FormState<K, F> {
  return applyTextInput(state, insertText(fieldInput(state.fields[state.focus]), char));
}

export function backspace<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, backspaceText(fieldInput(state.fields[state.focus])));
}

export function deleteForward<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, deleteText(fieldInput(state.fields[state.focus])));
}

export function moveFieldCursor<K extends string, F extends FormField<K>>(state: FormState<K, F>, delta: number): FormState<K, F> {
  return applyTextInput(state, moveCursor(fieldInput(state.fields[state.focus]), delta), true);
}

export function moveFieldCursorHome<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, moveCursorHome(fieldInput(state.fields[state.focus])), true);
}

export function moveFieldCursorEnd<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, moveCursorEnd(fieldInput(state.fields[state.focus])), true);
}

export function moveFieldCursorWordLeft<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, moveCursorWordLeft(fieldInput(state.fields[state.focus])), true);
}

export function moveFieldCursorWordRight<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, moveCursorWordRight(fieldInput(state.fields[state.focus])), true);
}

export function backspaceFieldWord<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, backspaceWord(fieldInput(state.fields[state.focus])));
}

export function deleteFieldWord<K extends string, F extends FormField<K>>(state: FormState<K, F>): FormState<K, F> {
  return applyTextInput(state, deleteWord(fieldInput(state.fields[state.focus])));
}

export function validateRequired<K extends string, F extends FormField<K>>(state: FormState<K, F>, keys: K[] = state.order): RequiredValidationResult<K, F> {
  const fields = { ...state.fields };
  let firstInvalid: K | undefined;
  for (const key of keys) {
    const field = fields[key];
    const trimmed = field.value.trim();
    if (!trimmed) {
      fields[key] = { ...field, error: `${field.label} is required` };
      firstInvalid ??= key;
    } else {
      fields[key] = { ...field, error: undefined, value: trimmed, cursor: Math.min(field.cursor ?? charLength(trimmed), charLength(trimmed)) };
    }
  }
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function value<K extends string, F extends FormField<K>>(state: FormState<K, F>, key: K): string {
  return state.fields[key].value;
}

export function setValue<K extends string, F extends FormField<K>>(state: FormState<K, F>, key: K, newValue: string, cursor = charLength(newValue)): FormState<K, F> {
  return {
    ...state,
    fields: { ...state.fields, [key]: { ...state.fields[key], value: newValue, cursor, error: undefined } },
  };
}

function applyTextInput<K extends string, F extends FormField<K>>(state: FormState<K, F>, input: { value: string; cursor: number }, keepError = false): FormState<K, F> {
  const field = state.fields[state.focus];
  return {
    ...state,
    fields: { ...state.fields, [state.focus]: { ...field, value: input.value, cursor: input.cursor, error: keepError ? field.error : undefined } },
  };
}

function normalizeField<K extends string, F extends FormField<K>>(field: F): F {
  return { ...field, cursor: field.cursor ?? charLength(field.value) };
}

function fieldInput(field: FormField): { value: string; cursor: number } {
  return createTextInput(field.value, field.cursor ?? charLength(field.value));
}
