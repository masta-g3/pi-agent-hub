import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DashboardCommand } from "../src/tui/dashboard-commands.js";
import {
  createCommandPalette,
  handleCommandPaletteInput,
  moveCommandPaletteSelection,
  normalizeCommandPalette,
  renderCommandPalette,
} from "../src/tui/command-palette-dialog.js";
import { darkTheme } from "../src/tui/theme.js";

function command(id: string, group: DashboardCommand["group"], label: string, values: Partial<DashboardCommand> = {}): DashboardCommand {
  return { id, group, label, hint: `${label} hint`, bindings: [], enabled: true, searchText: `${label} ${group}`.toLowerCase(), ...values };
}

const commands = [
  command("a", "actions", "Open", { displayKey: "Enter" }),
  command("b", "actions", "Rename", { displayKey: "R", enabled: false, disabledReason: "session is stopped" }),
  command("s", "sessions", "Builder"),
  command("f", "filters", "Status: Running"),
  command("v", "views", "Help", { displayKey: "?" }),
];

function searchCount(items: DashboardCommand[], query: string): number {
  return items.filter((item) => item.searchText.includes(query.toLowerCase())).length;
}

test("palette opens with cursor-aware query editing and deterministic result repair", () => {
  let state = createCommandPalette();
  let result = handleCommandPaletteInput(state, "r", commands);
  assert.equal(result.kind, "update");
  state = result.state;
  assert.deepEqual(state.query, { value: "r", cursor: 1 });
  assert.equal(state.selected, 0);
  assert.equal(state.selectedCommandId, "b");
  result = handleCommandPaletteInput(state, "u", commands);
  assert.equal(result.kind, "update");
  assert.equal(result.state.query.value, "ru");
  assert.deepEqual(result.matches.map((item) => item.id), ["f"]);
  assert.equal(normalizeCommandPalette({ ...state, selected: 99, selectedCommandId: undefined }, commands).selected, searchCount(commands, state.query.value) - 1);
});

test("normalization retains a stable selected command across catalog rebuilds", () => {
  const state = normalizeCommandPalette({ ...createCommandPalette(), selected: 2 }, commands);
  const rebuilt = [commands[4]!, commands[2]!, commands[0]!, commands[1]!, commands[3]!];
  const normalized = normalizeCommandPalette(state, rebuilt);
  assert.equal(normalized.selectedCommandId, "s");
  assert.equal(rebuilt[normalized.selected]?.id, "s");
});

test("selection wraps with arrows and Ctrl+P/Ctrl+N; Enter and Escape return effects", () => {
  let state = createCommandPalette();
  state = moveCommandPaletteSelection(state, -1, commands);
  assert.equal(state.selected, commands.length - 1);
  let result = handleCommandPaletteInput(state, "\u000e", commands);
  assert.equal(result.kind, "update");
  assert.equal(result.state.selected, 0);
  result = handleCommandPaletteInput(result.state, "\u0010", commands);
  assert.equal(result.kind, "update");
  assert.equal(result.state.selected, commands.length - 1);
  result = handleCommandPaletteInput(result.state, "\r", commands);
  assert.deepEqual(result, { kind: "execute", commandId: "v" });
  assert.deepEqual(handleCommandPaletteInput(createCommandPalette(), "\u001b", commands), { kind: "close" });
});

test("a selected target ID survives a catalog rebuild so Enter cannot drift", () => {
  const state = normalizeCommandPalette(createCommandPalette(), commands);
  assert.equal(state.selectedCommandId, "a");
  const replacement = [command("replacement", "actions", "Open replacement")];

  const normalized = normalizeCommandPalette(state, replacement);
  assert.equal(normalized.selectedCommandId, "a");
  assert.deepEqual(handleCommandPaletteInput(normalized, "\r", replacement), { kind: "execute", commandId: "a" });
});

test("rendering is ANSI-width safe at supported widths and hides narrow hints", () => {
  for (const width of [40, 60, 100, 160]) {
    const rendered = renderCommandPalette(createCommandPalette(), commands, width, 12, darkTheme);
    assert.equal(rendered.lines.length, 12);
    assert.equal(rendered.rowTargets.length, 12);
    for (const line of rendered.lines) assert.ok(visibleWidth(line) <= width, `${width}: ${visibleWidth(line)} ${line}`);
    assert.match(rendered.lines.join("\n"), /▸/);
    assert.match(rendered.lines.join("\n"), /Rename/);
    assert.match(rendered.lines.join("\n"), /unavailable|session is stopped/);
    if (width <= 60) assert.doesNotMatch(rendered.lines.join("\n"), /Open hint/);
    else assert.match(rendered.lines.join("\n"), /Open hint/);
  }
});

test("palette footer documents Ctrl+N/P navigation", () => {
  const rendered = renderCommandPalette(createCommandPalette(), commands, 80, 12);
  assert.match(rendered.lines.at(-1) ?? "", /Ctrl\+N\/P/);
});

test("short heights window around selection and retain its group context", () => {
  const many = Array.from({ length: 20 }, (_, index) => command(`s${index}`, index < 10 ? "sessions" : "filters", `Item ${index}`));
  const state = { ...createCommandPalette(), selected: 17 };
  const rendered = renderCommandPalette(state, many, 80, 7);
  assert.equal(rendered.lines.length, 7);
  assert.match(rendered.lines.join("\n"), /FILTERS/);
  assert.match(rendered.lines.join("\n"), /Item 17/);
  assert.ok(rendered.rowTargets.some((target) => target?.commandId === "s17"));
});

test("no-match rendering is bounded and clear", () => {
  const state = createCommandPalette("nothing matches");
  const rendered = renderCommandPalette(state, commands, 60, 6);
  assert.equal(rendered.lines.length, 6);
  assert.match(rendered.lines.join("\n"), /No matching commands/);
});
