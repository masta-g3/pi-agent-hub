import test from "node:test";
import assert from "node:assert/strict";
import { backspaceText, backspaceWord, createTextInput, deleteText, deleteWord, editKey, editTextInput, insertText, isEnterKey, moveCursor, moveCursorEnd, moveCursorHome, moveCursorWordLeft, moveCursorWordRight, renderTextInput } from "../src/tui/text-input.js";

const LEFT = "\u001b[D";
const RIGHT = "\u001b[C";
const HOME = "\u001b[H";
const END = "\u001b[F";
const CTRL_A = "\u0001";
const CTRL_E = "\u0005";
const CTRL_LEFT = "\u001b[1;5D";
const ALT_LEFT = "\u001b[1;3D";
const CTRL_RIGHT = "\u001b[1;5C";
const ALT_RIGHT = "\u001b[1;3C";
const BACKSPACE = "\u007f";
const DELETE = "\u001b[3~";
const CTRL_BACKSPACE = "\u001b[127;5u";
const ALT_BACKSPACE = "\u001b[127;3u";
const CTRL_W = "\u0017";
const CTRL_DELETE = "\u001b[3;5~";
const ALT_DELETE = "\u001b[3;3~";
const ALT_D = "\u001bd";
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

test("text input renders a clamped cursor with a configurable marker", () => {
  assert.equal(renderTextInput(createTextInput("a🙂c", 2)), "a🙂█c");
  assert.equal(renderTextInput(createTextInput("api", 1), "▌"), "a▌pi");
  assert.equal(renderTextInput({ value: "api", cursor: -1 }), "█api");
  assert.equal(renderTextInput({ value: "api", cursor: 99 }), "api█");
});

test("text input recognizes every compatible Enter sequence", () => {
  assert.equal(isEnterKey("\n"), true);
  assert.equal(isEnterKey("\r"), true);
  assert.equal(isEnterKey("x"), false);
});

test("text input inserts and deletes at cursor", () => {
  const start = createTextInput("api", 1);
  const inserted = insertText(start, "-x");
  assert.deepEqual(inserted, { value: "a-xpi", cursor: 3 });
  assert.deepEqual(backspaceText(inserted), { value: "a-pi", cursor: 2 });
  assert.deepEqual(deleteText(moveCursor(inserted, -1)), { value: "a-pi", cursor: 2 });
});

test("text input moves by character home and end", () => {
  const input = createTextInput("api", 1);
  assert.equal(moveCursor(input, -10).cursor, 0);
  assert.equal(moveCursor(input, 10).cursor, 3);
  assert.equal(moveCursorHome(input).cursor, 0);
  assert.equal(moveCursorEnd(input).cursor, 3);
});

test("text input moves and deletes by word", () => {
  const input = createTextInput("alpha beta gamma", 16);
  assert.deepEqual(moveCursorWordLeft(input), { value: "alpha beta gamma", cursor: 11 });
  assert.deepEqual(moveCursorWordRight(createTextInput("alpha beta gamma", 6)), { value: "alpha beta gamma", cursor: 11 });
  assert.deepEqual(backspaceWord(createTextInput("alpha beta gamma", 11)), { value: "alpha gamma", cursor: 6 });
  assert.deepEqual(deleteWord(createTextInput("alpha beta gamma", 6)), { value: "alpha gamma", cursor: 6 });
});

test("editKey classifies navigation separately from edits", () => {
  assert.equal(editKey(LEFT)?.kind, "move");
  assert.equal(editKey(RIGHT)?.kind, "move");
  assert.equal(editKey(HOME)?.kind, "move");
  assert.equal(editKey(CTRL_A)?.kind, "move");
  assert.equal(editKey(END)?.kind, "move");
  assert.equal(editKey(CTRL_E)?.kind, "move");
  assert.equal(editKey(CTRL_LEFT)?.kind, "move");
  assert.equal(editKey(ALT_LEFT)?.kind, "move");
  assert.equal(editKey(CTRL_RIGHT)?.kind, "move");
  assert.equal(editKey(ALT_RIGHT)?.kind, "move");

  assert.equal(editKey(BACKSPACE)?.kind, "edit");
  assert.equal(editKey(DELETE)?.kind, "edit");
  assert.equal(editKey(CTRL_BACKSPACE)?.kind, "edit");
  assert.equal(editKey(ALT_BACKSPACE)?.kind, "edit");
  assert.equal(editKey(CTRL_W)?.kind, "edit");
  assert.equal(editKey(CTRL_DELETE)?.kind, "edit");
  assert.equal(editKey(ALT_DELETE)?.kind, "edit");
  assert.equal(editKey(ALT_D)?.kind, "edit");
  assert.equal(editKey("x")?.kind, "edit");

  assert.equal(editKey("\t"), undefined);
  assert.equal(editKey("\u0002"), undefined);
});

test("editTextInput applies classified editing keys", () => {
  let input = createTextInput("alpha beta", 5);
  input = editTextInput("-", input)!;
  assert.deepEqual(input, { value: "alpha- beta", cursor: 6 });
  assert.deepEqual(editTextInput(CTRL_LEFT, input), { value: "alpha- beta", cursor: 0 });
  assert.deepEqual(editTextInput(ALT_RIGHT, createTextInput("alpha beta", 0)), { value: "alpha beta", cursor: 6 });
  assert.deepEqual(editTextInput(CTRL_W, createTextInput("alpha beta", 10)), { value: "alpha ", cursor: 6 });
  assert.deepEqual(editTextInput(ALT_D, createTextInput("alpha beta", 0)), { value: "beta", cursor: 0 });
});

test("editTextInput inserts a bracketed paste at the cursor as single-line text", () => {
  const paste = `${PASTE_START}one\r\ntwo\nthree\rfour🙂${PASTE_END}`;
  assert.equal(editKey(paste)?.kind, "edit");
  assert.deepEqual(editTextInput(paste, createTextInput("ac", 1)), {
    value: "aone two three four🙂c",
    cursor: 20,
  });
});

test("bracketed paste treats embedded controls as text instead of editing commands", () => {
  const paste = `${PASTE_START}x${LEFT}y${BACKSPACE}z\tend${PASTE_END}`;
  assert.deepEqual(editTextInput(paste, createTextInput("tail", 0)), {
    value: "x[Dyz endtail",
    cursor: 9,
  });
});
