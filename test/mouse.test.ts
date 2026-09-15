import test from "node:test";
import assert from "node:assert/strict";
import { isMouseSequence, parseMouseEvent } from "../src/tui/mouse.js";

test("parseMouseEvent parses left press coordinates", () => {
  assert.deepEqual(parseMouseEvent("\u001b[<0;12;34M"), { kind: "press", x: 12, y: 34 });
});

test("parseMouseEvent ignores releases and modified clicks", () => {
  assert.equal(parseMouseEvent("\u001b[<0;3;4m"), undefined);
  assert.equal(parseMouseEvent("\u001b[<16;3;4M"), undefined);
});

test("parseMouseEvent parses wheel direction", () => {
  assert.deepEqual(parseMouseEvent("\u001b[<64;5;6M"), { kind: "wheel", delta: -1, x: 5, y: 6 });
  assert.deepEqual(parseMouseEvent("\u001b[<65;5;6M"), { kind: "wheel", delta: 1, x: 5, y: 6 });
});

test("isMouseSequence recognizes mouse encodings only", () => {
  assert.equal(isMouseSequence("\u001b[<0;1;1M"), true);
  assert.equal(isMouseSequence("\u001b[M abc"), true);
  assert.equal(isMouseSequence("o"), false);
  assert.equal(isMouseSequence("\u001b[A"), false);
});
