import test from "node:test";
import assert from "node:assert/strict";
import { backspaceText, backspaceWord, createTextInput, deleteText, deleteWord, insertText, moveCursor, moveCursorEnd, moveCursorHome, moveCursorWordLeft, moveCursorWordRight } from "../src/tui/text-input.js";

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
