import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { modelBadge, modelTag, modelVendor } from "../src/tui/model-badge.js";
import { nerdModelIcons as nerd } from "../src/tui/glyphs.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";

test("model tags shorten realistic ids and keep unknown ids bounded", () => {
  const cases: [string, string, string][] = [
    ["anthropic", "claude-opus-4-5", "opus4.5"],
    ["anthropic", "claude-sonnet-4-5-20250929", "son4.5"],
    ["claude-code", "claude-opus-5-5", "opus5.5"],
    ["anthropic", "claude-haiku-4-5", "haiku4.5"],
    ["anthropic", "claude-3-5-sonnet-20241022", "son3.5"],
    ["openai", "gpt-5", "gpt5"],
    ["openai-codex", "gpt-5.1-codex", "gpt5.1c"],
    ["openai", "gpt-5-mini", "gpt5m"],
    ["openai", "o3", "o3"],
    ["google", "gemini-2.5-pro", "gem2.5p"],
    ["google", "gemini-2.5-flash", "gem2.5f"],
    ["openrouter", "anthropic/claude-sonnet-4-5", "son4.5"],
    ["ollama", "qwen3-coder:30b-instruct", "qwen3-co"],
  ];
  for (const [provider, id, tag] of cases) assert.equal(modelTag({ provider, id }), tag, id);
});

test("vendor comes from the model id first, then the provider", () => {
  assert.equal(modelVendor({ provider: "claude-code", id: "claude-opus-5-5" }), "anthropic");
  assert.equal(modelVendor({ provider: "openrouter", id: "openai/gpt-5" }), "openai");
  assert.equal(modelVendor({ provider: "openai-codex", id: "codex-mini" }), "openai");
  assert.equal(modelVendor({ provider: "google", id: "gemini-2.5-pro" }), "google");
  assert.equal(modelVendor({ provider: "anthropic", id: "custom-router" }), "anthropic");
  assert.equal(modelVendor({ provider: "ollama", id: "qwen3" }), undefined);
});

test("only Nerd Font icons add a one-cell vendor icon", () => {
  const model = { provider: "anthropic", id: "claude-opus-4-5" };
  assert.equal(modelBadge(model, undefined), "opus4.5");
  assert.equal(modelBadge(model, nerd), "\u{EC82} opus4.5");
  assert.equal(modelBadge({ provider: "openai", id: "gpt-5" }, nerd), "\u{EC81} gpt5");
  assert.equal(modelBadge({ provider: "google", id: "gemini-2.5-pro" }, nerd), "\u{F02AD} gem2.5p");
  assert.equal(modelBadge({ provider: "ollama", id: "qwen3" }, nerd), "\u{EC20} qwen3");
  assert.equal(visibleWidth(modelBadge(model, nerd)), 9);
});

const NOW = 1_800_000_000_000;
const opus = { provider: "claude-code", id: "claude-opus-5-5", thinking: "medium" };
function session(id: string, values: Partial<RuntimeSession> = {}): RuntimeSession {
  return { id, title: `Title-${id}`, cwd: "/tmp/repo", group: "team", tmuxSession: id,
    status: "running", createdAt: NOW - 120_000, updatedAt: NOW, lastActivityAt: NOW - 180_000, ...values };
}
function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  return renderSessions(buildRenderModel({ sessions, selectedId: sessions[0]!.id, width: 120,
    height: 40, now: NOW, guidanceHidden: true, ...input }), darkTheme);
}
function lineOf(layout: ReturnType<typeof render>, id: string): string {
  const index = layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === id);
  assert.notEqual(index, -1, `missing row for ${id}`);
  return stripAnsi(layout.lines[index]!);
}

test("fleet, pin and subagent rows show the tag; the card adds thinking and provider", () => {
  const rows = [
    session("sel", { model: opus }),
    session("other", { model: { provider: "openai", id: "gpt-5" } }),
    session("child", { kind: "subagent", parentId: "other", agentName: "scout", taskPreview: "Inspect", model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
    session("bare"),
  ];
  const fleet = render(rows, { expandedProjectParentIds: new Set(["other"]) });
  assert.match(lineOf(fleet, "other"), /Title-other.*gpt5/);
  assert.match(lineOf(fleet, "child"), /scout.*son4\.5/);
  assert.doesNotMatch(lineOf(fleet, "bare"), /opus|gpt/);
  assert.ok(fleet.lines.some(line => /opus5\.5 · medium · claude-code/.test(stripAnsi(line))), "card names model, thinking and provider");

  const pins = render(rows, { pinSlots: ["sel"], expandedProjectParentIds: new Set(["other"]) });
  // Pin rows carry metadata on the line under the title.
  const pinTitle = pins.rowTargets.findIndex(target => target?.kind === "session" && target.id === "other");
  assert.match(stripAnsi(pins.lines[pinTitle + 1]!), /\[team\].*3m · gpt5/);
});

test("stopped rows show no model", () => {
  const layout = render([session("a"), session("gone", { status: "stopped", model: opus })]);
  assert.doesNotMatch(lineOf(layout, "gone"), /opus/);
});

test("narrow rows drop the model before the age and readable title", () => {
  for (const width of [44, 60, 80, 100, 120, 160]) {
    const rows = [session("a"), session("long", { title: "A fairly long readable session title", model: opus })];
    const withModel = render(rows, { width });
    const without = render([rows[0]!, { ...rows[1]!, model: undefined }], { width });
    const line = lineOf(withModel, "long");
    const base = lineOf(without, "long");
    assert.ok(visibleWidth(line) <= width);
    if (line.includes("opus")) {
      // The badge only fills spare room: the title and age stay as they were without it.
      assert.equal(line.replace(/\s+opus5\.5/, "").replace(/\s+/g, " "), base.replace(/\s+/g, " "), `${width}: ${line}`);
    }
  }
});

test("the badge never changes any other signal on fleet, board or card rows", () => {
  const mode = { id: "focus", short: "FOC", label: "Focus" };
  const workflow = { version: 1 as const, source: "test", steps: [{ id: "plan", short: "PL" }, { id: "execute", short: "EX" }], activeIndex: 1, updatedAt: NOW, activeMode: mode };
  const parent = session("p", { title: "Board parent title", unopened: true, workflow, additionalCwds: ["/tmp/other"], model: opus });
  const child = session("c", { kind: "subagent", parentId: "p", agentName: "scout" });
  const strip = (line: string) => line.replace(/(?:\s+·)?\s+opus5\.5(?: · medium · claude-code)?/g, "").replace(/\s+/g, " ").trimEnd();
  for (let width = 30; width <= 160; width += 1) for (const grouping of ["project", "stage"] as const) {
    const input = { width, grouping, selectedId: "p", expandedBoardParentIds: new Set(["p"]) };
    const withModel = render([parent, child], input).lines.map(stripAnsi);
    const without = render([{ ...parent, model: undefined }, child], input).lines.map(stripAnsi);
    withModel.forEach((line, index) => {
      assert.ok(visibleWidth(line) <= width);
      assert.equal(strip(line), strip(without[index]!), `${grouping} ${width}: ${line}`);
    });
  }
});
