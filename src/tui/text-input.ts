export interface TextInputState {
  value: string;
  cursor: number;
}

export function createTextInput(value = "", cursor = charLength(value)): TextInputState {
  return normalizeTextInput({ value, cursor });
}

export function normalizeTextInput(state: TextInputState): TextInputState {
  return { ...state, cursor: Math.max(0, Math.min(state.cursor, charLength(state.value))) };
}

export function insertText(state: TextInputState, text: string): TextInputState {
  const input = normalizeTextInput(state);
  const chars = charsOf(input.value);
  chars.splice(input.cursor, 0, ...charsOf(text));
  return { value: chars.join(""), cursor: input.cursor + charLength(text) };
}

export function backspaceText(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  if (input.cursor === 0) return input;
  const chars = charsOf(input.value);
  chars.splice(input.cursor - 1, 1);
  return { value: chars.join(""), cursor: input.cursor - 1 };
}

export function deleteText(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  const chars = charsOf(input.value);
  if (input.cursor >= chars.length) return input;
  chars.splice(input.cursor, 1);
  return { value: chars.join(""), cursor: input.cursor };
}

export function moveCursor(state: TextInputState, delta: number): TextInputState {
  const input = normalizeTextInput(state);
  return normalizeTextInput({ ...input, cursor: input.cursor + delta });
}

export function moveCursorHome(state: TextInputState): TextInputState {
  return { ...state, cursor: 0 };
}

export function moveCursorEnd(state: TextInputState): TextInputState {
  return { ...state, cursor: charLength(state.value) };
}

export function moveCursorWordLeft(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  const chars = charsOf(input.value);
  let cursor = input.cursor;
  while (cursor > 0 && isWordSpace(chars[cursor - 1]!)) cursor -= 1;
  while (cursor > 0 && !isWordSpace(chars[cursor - 1]!)) cursor -= 1;
  return { ...input, cursor };
}

export function moveCursorWordRight(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  const chars = charsOf(input.value);
  let cursor = input.cursor;
  while (cursor < chars.length && !isWordSpace(chars[cursor]!)) cursor += 1;
  while (cursor < chars.length && isWordSpace(chars[cursor]!)) cursor += 1;
  return { ...input, cursor };
}

export function backspaceWord(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  const start = moveCursorWordLeft(input).cursor;
  if (start === input.cursor) return input;
  const chars = charsOf(input.value);
  chars.splice(start, input.cursor - start);
  if (start > 0 && chars[start - 1] === " " && chars[start] === " ") chars.splice(start, 1);
  return { value: chars.join(""), cursor: start };
}

export function deleteWord(state: TextInputState): TextInputState {
  const input = normalizeTextInput(state);
  const end = moveCursorWordRight(input).cursor;
  if (end === input.cursor) return input;
  const chars = charsOf(input.value);
  chars.splice(input.cursor, end - input.cursor);
  if (input.cursor > 0 && chars[input.cursor - 1] === " " && chars[input.cursor] === " ") chars.splice(input.cursor, 1);
  return { value: chars.join(""), cursor: input.cursor };
}

export function charLength(value: string): number {
  return charsOf(value).length;
}

function charsOf(value: string): string[] {
  return [...value];
}

function isWordSpace(char: string): boolean {
  return /\s/.test(char);
}
