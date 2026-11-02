import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";
import { buildDashboardCommands, dashboardHelpSections } from "../src/tui/dashboard-commands.js";
import { mergeUsageSnapshots, parseUsageSnapshot } from "../src/core/usage.js";
import { stripAnsi } from "../src/tui/theme.js";

test("refresh exposes cached usage only in runtime, never registry or UI state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-usage-refresh-")), old = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await mkdir(join(dir, "usage"));
    const file = join(dir, "usage", "snapshot.json");
    await writeFile(file, JSON.stringify(usageFixture()));
    await writeFile(join(dir, "registry.json"), JSON.stringify({ version: 1, sessions: [] }));
    const controller = new SessionsController();
    await controller.refresh(USAGE_NOW);
    const first = controller.snapshot().usage!.histories[0];
    await controller.refresh(USAGE_NOW);
    assert.equal(controller.snapshot().usage!.histories[0], first);
    await writeFile(file, JSON.stringify({ ...usageFixture(), history: { ...usageFixture().history, source: "changed-source" } }));
    await controller.refresh(USAGE_NOW);
    assert.equal(controller.snapshot().usage!.histories[0]!.source, "changed-source");
    assert.equal((await readFile(join(dir, "registry.json"), "utf8")).includes("usage"), false);
    await assert.rejects(stat(join(dir, "ui-state.json")), { code: "ENOENT" });
  } finally { if (old === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = old; await rm(dir, { recursive: true, force: true }); }
});

test("Usage is catalog-owned, opens from key and palette, closes without quitting", () => {
  assert.ok(buildDashboardCommands({ sessions: [] }).some(c => c.id === "view:usage" && c.displayKey === "u" && c.label === "Usage"));
  assert.ok(JSON.stringify(dashboardHelpSections()).includes("Usage"));
  let stopped = false;
  const controller = new SessionsController();
  const view = new SessionsView(controller, () => { stopped = true; }, { terminalRows: () => 24 });
  for (const close of ["\x1b", "q", "u"]) {
    view.handleInput("u");
    assert.match(view.render(80).map(stripAnsi).join("\n"), /USAGE/);
    view.handleInput(close);
    assert.doesNotMatch(view.render(80).map(stripAnsi).join("\n"), /USAGE/);
    assert.equal(stopped, false);
  }
  view.handleInput(":"); view.render(80);
  for (const c of "Usage") view.handleInput(c);
  view.handleInput("\r");
  assert.match(view.render(80).map(stripAnsi).join("\n"), /USAGE/);
});

test("header quota click opens Limits; mouse tabs and chart cursor use dialog hits", () => {
  const controller = new SessionsController();
  const snapshot = controller.snapshot.bind(controller);
  controller.snapshot = () => ({ ...snapshot(), usage: mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]) });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 24, now: () => USAGE_NOW });
  const rows = view.render(160).map(stripAnsi);
  const row = rows.findIndex(r => r.includes("Codex 1"));
  const x = rows[row]!.indexOf("Codex 1") + 1;
  view.handleInput(`\x1b[<0;${x};${row + 1}M`);
  assert.match(view.render(160).map(stripAnsi).join("\n"), /\[Limits\]/);
  view.handleInput("c");
  const page = view.render(160).map(stripAnsi);
  const tokensX = page[1]!.indexOf("Tokens") + 1;
  view.handleInput(`\x1b[<0;${tokensX};2M`);
  assert.match(view.render(160).map(stripAnsi).join("\n"), /\[Tokens\]/);
});
