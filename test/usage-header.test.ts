import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { visibleWidth as displayWidth } from "@earendil-works/pi-tui";
import { mergeUsageSnapshots, parseUsageSnapshot } from "../src/core/usage.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";
import { stripAnsi, darkTheme } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";
const data = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
const sessions: RuntimeSession[] = [{ id: "a", title: "Work", cwd: "/tmp", group: "Work", tmuxSession: "fake", createdAt: USAGE_NOW, updatedAt: USAGE_NOW, status: "waiting", context: { version: 1, updatedAt: USAGE_NOW, attention: { kind: "question", requestId: "r", text: "Please answer" } } }];
for (const width of [200, 140, 100, 80, 60, 40]) for (const mode of ["status", "repo", "board", "pin"]) test(`usage header ${mode} ${width} preserves signals and hits`, () => {
  const input = { sessions, width, height: 24, now: USAGE_NOW, grouping: mode === "board" ? "stage" as const : "project" as const, fleetGrouping: mode === "repo" ? "repo" as const : "status" as const, pinSlots: mode === "pin" ? ["a"] : [] };
  const before = renderSessions(buildRenderModel(input), darkTheme);
  const after = renderSessions(buildRenderModel({ ...input, usage: data }), darkTheme);
  assert.deepEqual(after.tierChips, before.tierChips);
  // The dashboard is frameless: the header band is always the first row.
  const plain = stripAnsi(after.lines[0]!);
  assert.ok(plain.includes(mode === "status" ? "NEEDS YOU 1" : "1 needs you"));
  for (const line of after.lines) assert.ok(displayWidth(line) <= width);
  if (width >= 140) { assert.ok(plain.includes("Codex 1")); assert.ok(after.usageHit); }
  if (width >= 140) assert.ok(plain.includes("~Codex 2"));
  assert.deepEqual(renderSessions(buildRenderModel({ ...input, usage: mergeUsageSnapshots([]) }), darkTheme).lines, before.lines);
});
