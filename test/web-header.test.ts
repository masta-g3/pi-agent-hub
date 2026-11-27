import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as displayWidth } from "@earendil-works/pi-tui";
import { SessionsController } from "../src/app/controller.js";
import { mergeUsageSnapshots, parseUsageSnapshot } from "../src/core/usage.js";
import type { RuntimeSession } from "../src/core/types.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";

const usage = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
const row = (id: string, values: Partial<RuntimeSession> = {}): RuntimeSession => ({ id, title: `Work ${id}`, cwd: `/tmp/${id}`, group: "Work", tmuxSession: `fake-${id}`, createdAt: USAGE_NOW, updatedAt: USAGE_NOW, status: "running", ...values });
const sessions: RuntimeSession[] = [
  row("a", { status: "waiting", context: { version: 1, updatedAt: USAGE_NOW, attention: { kind: "question", requestId: "r", text: "Please answer" } } }),
  row("b"), row("c", { status: "error" }), row("d", { status: "idle" }),
];
const SUFFIX = " · web";
const shown = new Map<string, boolean>();

for (const width of [200, 140, 100, 80, 60, 40]) for (const mode of ["status", "repo", "board", "pin"]) for (const withUsage of [false, true]) {
  test(`web signal ${mode} ${width}${withUsage ? " with quota" : ""} fits last and keeps other hits`, () => {
    const input = {
      sessions, width, height: 24, now: USAGE_NOW, ...(withUsage ? { usage } : {}),
      grouping: mode === "board" ? "stage" as const : "project" as const,
      fleetGrouping: mode === "repo" ? "repo" as const : "status" as const,
      pinSlots: mode === "pin" ? ["b"] : [],
    };
    const before = renderSessions(buildRenderModel(input), darkTheme);
    const after = renderSessions(buildRenderModel({ ...input, webPorts: [4747] }), darkTheme);
    const baseline = stripAnsi(before.lines[0]!);
    const header = stripAnsi(after.lines[0]!);
    for (const line of after.lines) assert.ok(displayWidth(line) <= width, line);
    assert.deepEqual(after.lines.slice(1), before.lines.slice(1));
    assert.deepEqual(after.usageHit, before.usageHit);
    shown.set(`${mode} ${width}${withUsage ? " quota" : ""}`, Boolean(after.webHit));
    if (!after.webHit) {
      // Dropped: everything is exactly as without the inbox.
      assert.equal(header, baseline);
      assert.deepEqual(after.tierChips, before.tierChips);
      assert.ok(width < 140 || withUsage, `web should fit at ${width}`);
      return;
    }
    // Shown: the baseline's right side moved left by the suffix; nothing else shortened.
    assert.ok(header.endsWith(SUFFIX), header);
    // Same text left to right, only the gap narrowed to make room.
    const squeeze = (line: string) => line.replace(/\s+/gu, " ").trim();
    assert.equal(squeeze(header.slice(0, -SUFFIX.length)), squeeze(baseline));
    assert.deepEqual(after.webHit, { row: 0, x: width - 2, width: 3 });
    assert.equal(header.slice(after.webHit.x - 1, after.webHit.x - 1 + after.webHit.width), "web");
    assert.equal(after.tierChips.length, before.tierChips.length);
    for (const [index, chip] of after.tierChips.entries()) {
      const was = before.tierChips[index]!;
      assert.equal(chip.tier, was.tier);
      assert.equal(chip.width, was.width);
      assert.equal(chip.x, was.x - SUFFIX.length);
      assert.equal(header.slice(chip.x - 1, chip.x - 1 + chip.width), baseline.slice(was.x - 1, was.x - 1 + was.width));
    }
  });
}

test("an empty dashboard shows web and its click target", () => {
  const layout = renderSessions(buildRenderModel({ sessions: [], width: 100, height: 24, now: USAGE_NOW, webPorts: [4747] }), darkTheme);
  assert.ok(stripAnsi(layout.lines[0]!).endsWith(" · web"));
  assert.deepEqual(layout.webHit, { row: 0, x: 98, width: 3 });
  const without = renderSessions(buildRenderModel({ sessions: [], width: 100, height: 24, now: USAGE_NOW }), darkTheme);
  assert.equal(without.webHit, undefined);
});

test("no phone inbox leaves the header unchanged", () => {
  const input = { sessions, width: 140, height: 24, now: USAGE_NOW };
  const before = renderSessions(buildRenderModel(input), darkTheme);
  const after = renderSessions(buildRenderModel({ ...input, webPorts: [] }), darkTheme);
  assert.deepEqual(after.lines, before.lines);
  assert.equal(after.webHit, undefined);
});

test("clicking web shows where the inbox runs and never stops it", () => {
  const calls: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [{ id: "a", title: "a", cwd: "/tmp/a", group: "g", tmuxSession: "pi-agent-hub-a", status: "idle", createdAt: 1, updatedAt: 1 }] }), () => {}, {
    terminalRows: () => 24,
    webInbox: {
      ports: () => [4747],
      start: async () => { calls.push("start"); return { port: 4747 }; },
      stop: async () => { calls.push("stop"); return 1; },
      autostart: () => false,
      setAutostart: () => { calls.push("autostart"); },
    },
  });
  const header = stripAnsi(view.render(120)[0]!);
  const x = header.lastIndexOf("web") + 1;
  view.handleInput(`\x1b[<0;${x};1M`);
  const frame = stripAnsi(view.render(120).join("\n"));
  assert.match(frame, /phone inbox on 127\.0\.0\.1:4747 · ": Phone inbox" stops it/u);
  assert.deepEqual(calls, []);
});

test("web shows on roomy headers and drops on tight ones", () => {
  assert.equal(shown.get("status 200 quota"), true);
  assert.equal(shown.get("board 100"), true);
  assert.ok([...shown.values()].some((value) => !value), "some narrow header drops web");
});
