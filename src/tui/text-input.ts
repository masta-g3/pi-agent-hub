import { Key, matchesKey } from "@earendil-works/pi-tui";

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

export function isEnterKey(data: string): boolean {
  return matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r";
}

export function renderTextInput(input: TextInputState, marker = "█"): string {
  const chars = [...input.value];
  const cursor = Math.max(0, Math.min(input.cursor, chars.length));
  return `${chars.slice(0, cursor).join("")}${marker}${chars.slice(cursor).join("")}`;
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

export interface EditKey {
  kind: "move" | "edit";
  apply(state: TextInputState): TextInputState;
}

export function editKey(data: string): EditKey | undefined {
  const paste = bracketedPaste(data);
  if (paste !== undefined) return { kind: "edit", apply: (state) => insertText(state, paste) };
  if (matchesKey(data, Key.left)) return { kind: "move", apply: (state) => moveCursor(state, -1) };
  if (matchesKey(data, Key.right)) return { kind: "move", apply: (state) => moveCursor(state, 1) };
  if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) return { kind: "move", apply: moveCursorHome };
  if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) return { kind: "move", apply: moveCursorEnd };
  if (wordLeft(data)) return { kind: "move", apply: moveCursorWordLeft };
  if (wordRight(data)) return { kind: "move", apply: moveCursorWordRight };
  if (matchesKey(data, Key.backspace)) return { kind: "edit", apply: backspaceText };
  if (matchesKey(data, Key.delete)) return { kind: "edit", apply: deleteText };
  if (wordBackspace(data)) return { kind: "edit", apply: backspaceWord };
  if (wordDelete(data)) return { kind: "edit", apply: deleteWord };
  if (isPrintable(data)) return { kind: "edit", apply: (state) => insertText(state, data) };
  return undefined;
}

export function editTextInput(data: string, state: TextInputState): TextInputState | undefined {
  return editKey(data)?.apply(state);
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

function wordLeft(data: string): boolean {
  return matchesKey(data, Key.ctrl("left")) || matchesKey(data, Key.alt("left"));
}

function wordRight(data: string): boolean {
  return matchesKey(data, Key.ctrl("right")) || matchesKey(data, Key.alt("right"));
}

function wordBackspace(data: string): boolean {
  return matchesKey(data, Key.ctrl("backspace")) || matchesKey(data, Key.alt("backspace")) || matchesKey(data, Key.ctrl("w"));
}

function wordDelete(data: string): boolean {
  return matchesKey(data, Key.ctrl("delete")) || matchesKey(data, Key.alt("delete")) || matchesKey(data, Key.alt("d"));
}

function isPrintable(data: string): boolean {
  return [...data].length === 1 && data >= " " && data !== "\u007f";
}

function bracketedPaste(data: string): string | undefined {
  const start = "\u001b[200~";
  const end = "\u001b[201~";
  if (!data.startsWith(start) || !data.endsWith(end)) return undefined;
  return data
    .slice(start.length, -end.length)
    .replace(/\r\n/g, " ")
    .replace(/[\t-\r\u0085\u2028\u2029]/g, " ")
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, "");
}
