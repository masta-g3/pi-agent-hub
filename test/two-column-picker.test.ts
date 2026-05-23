import test from "node:test";
import assert from "node:assert/strict";
import { movePickerSelection, renderTwoColumnPicker, switchPickerColumn, togglePickerItem } from "../src/tui/two-column-picker.js";
import { createTextInput } from "../src/tui/text-input.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";

test("picker toggles selected item", () => {
  const state = { title: "Skills", selected: 0, items: [{ name: "a", enabled: false }] };
  assert.equal(togglePickerItem(state).items[0]?.enabled, true);
});

test("picker moves selection with wraparound", () => {
  const state = { title: "Skills", selected: 0, items: [{ name: "a", enabled: false }, { name: "b", enabled: false }] };
  assert.equal(movePickerSelection(state, -1).selected, 1);
});

test("picker switches between enabled and available columns", () => {
  let state = {
    title: "Skills",
    selected: 0,
    items: [
      { name: "available-a", enabled: false },
      { name: "enabled-a", enabled: true },
      { name: "enabled-b", enabled: true },
      { name: "available-b", enabled: false },
    ],
  };

  state = switchPickerColumn(state);
  assert.equal(state.selected, 1);
  state = movePickerSelection(state, 1);
  assert.equal(state.selected, 2);
  state = switchPickerColumn(state);
  assert.equal(state.selected, 3);
});

test("picker renders enabled and available columns", () => {
  const lines = renderTwoColumnPicker({ title: "Skills", selected: 0, items: [{ name: "a", enabled: true }, { name: "b", enabled: false }] }, 80);
  assert.match(lines.join("\n"), /Enabled\s+Available/);
  assert.match(lines.join("\n"), /> ✓ a/);
  assert.match(lines.join("\n"), /b/);
});

test("picker renders skill pool path and edit hint", () => {
  const lines = renderTwoColumnPicker({ title: "Skills", selected: 0, poolDir: "/tmp/skills", items: [{ name: "a", enabled: true }] }, 80);
  const rendered = lines.join("\n");
  assert.match(rendered, /pool: \/tmp\/skills/);
  assert.match(rendered, /Alt\+E edit/);
  assert.match(rendered, /Alt\+E edit pool/);
});

test("picker renders skill pool input cursor while editing", () => {
  const lines = renderTwoColumnPicker({ title: "Skills", selected: 0, poolInput: createTextInput("/tmp/skills", 4), items: [] }, 80);
  assert.match(lines.join("\n"), /pool: \/tmp█\/skills/);
  assert.match(lines.join("\n"), /enter save\/reload/);
});

test("themed picker keeps narrow terminal width", () => {
  const lines = renderTwoColumnPicker({ title: "Skills", selected: 0, poolDir: "/tmp/" + "long-name".repeat(8), items: [{ name: "long-name".repeat(4), enabled: true }] }, 50, darkTheme);
  for (const line of lines) assert.ok(stripAnsi(line).length <= 50, stripAnsi(line));
});
