import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createUsageView, renderUsageView, handleUsageInput, stackUsageCells, quotaSegment } from "../src/tui/usage-view.js";
import { parseUsageSnapshot, mergeUsageSnapshots } from "../src/core/usage.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";
const data = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
for (const [width, height] of [[160, 48], [100, 30], [80, 24], [50, 20], [30, 16]]) for (const tab of ["cost", "tokens", "limits"] as const) test(`Usage ${tab} fits ${width}x${height}`, () => {
  const state = { ...createUsageView(), tab };
  const page = renderUsageView(data, state, width!, height!, USAGE_NOW, darkTheme);
  assert.equal(page.lines.length, height);
  assert.ok(page.lines.every(line => visibleWidth(line) <= width!), page.lines.map(stripAnsi).join("\n"));
  assert.match(page.lines.map(stripAnsi).join("\n"), /USAGE/);
  assert.ok(page.hits.length > 0);
  if (tab === "cost") assert.match(page.lines.map(stripAnsi).join("\n"), /est\. API cost/);
  if (tab === "limits" && width! >= 80) assert.match(page.lines.map(stripAnsi).join("\n"), /Login expired/);
});
test("empty, partial snapshots and unpriced are explicit", () => {
  assert.match(renderUsageView(mergeUsageSnapshots([]), createUsageView(), 80, 24, USAGE_NOW).lines.join("\n"), /No usage data yet/);
  const limits = mergeUsageSnapshots([parseUsageSnapshot({ ...usageFixture(), history: undefined }, USAGE_NOW)!]);
  assert.match(renderUsageView(limits, createUsageView(), 80, 24, USAGE_NOW).lines.join("\n"), /No usage history/);
  const history = mergeUsageSnapshots([parseUsageSnapshot({ ...usageFixture(), accounts: [] }, USAGE_NOW)!]);
  assert.match(renderUsageView(history, { ...createUsageView(), tab: "limits" }, 80, 24, USAGE_NOW).lines.join("\n"), /No account limits/);
  assert.match(renderUsageView(data, createUsageView(), 160, 48, USAGE_NOW).lines.join("\n"), /unpriced/);
});
test("model rows show their plain provider name without chart swatches", () => {
  const raw = usageFixture();
  raw.history.providers.push({ id: "other", label: "Fourth Co" });
  const snapshot = mergeUsageSnapshots([parseUsageSnapshot(raw, USAGE_NOW)!]);
  const page = renderUsageView(snapshot, createUsageView(), 160, 48, USAGE_NOW);
  const row = page.lines.map(stripAnsi).find(line => line.includes("unknown-model"))!;
  assert.match(row, / Fourth Co /);
  assert.doesNotMatch(row, /[█▓▒░] Fourth Co|Other/);
});

test("the chart highlights the selected breakdown row against everything else", () => {
  const data = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
  const render = (selected: number) => renderUsageView(data, { ...createUsageView(), selected }, 160, 48, USAGE_NOW).lines.map(stripAnsi);
  const first = render(0), second = render(1);
  const rows = (lines: string[]) => lines.filter(line => / (?:Codex|Claude|OpenAI|Anthropic) /.test(line) && /%/.test(line) && !line.includes(" total "));
  const name = (line: string) => line.replace(/^[│ ▌]+/, "").split(/\s{2,}/)[0]!;
  const [a, b] = rows(first);
  const readout = (lines: string[]) => lines.find(line => line.includes(" total "))!;
  assert.match(readout(first), new RegExp(`█ ${name(a!)} · \\w+ `), "model readouts name the provider");
  assert.match(readout(second), new RegExp(`█ ${name(b!)} · \\w+ `));
  assert.doesNotMatch(readout(first), /Other/);
  assert.match(rows(first)[0]!, /█/);
  assert.doesNotMatch(rows(first)[1]!, /█/);
  assert.match(rows(second)[1]!, /█/);
  const chart = first.join("\n");
  assert.match(chart, /█/); assert.match(chart, /░/);
  assert.doesNotMatch(chart, /by provider/);
});

test("stack cells conserve height with deterministic largest remainder", () => {
  assert.deepEqual(stackUsageCells([1, 1, 1], 5), [2, 2, 1]);
  assert.deepEqual(stackUsageCells([0, 0], 0), [0, 0]);
});
test("inputs keep state transient, navigate and close without leaking dashboard commands", () => {
  const state = createUsageView();
  assert.equal(handleUsageInput(state, "t"), false);
  assert.equal(state.tab, "tokens");
  handleUsageInput(state, "5"); assert.equal(state.period, "all");
  handleUsageInput(state, "b"); assert.equal(state.breakdown, "providers");
  handleUsageInput(state, "l"); handleUsageInput(state, "1"); assert.equal(state.period, "all");
  handleUsageInput(state, "\x1b[B"); assert.equal(state.limitScroll, 1);
  for (const key of ["u", "q", "\x1b"]) assert.equal(handleUsageInput(state, key), true);
});
test("rendering is pure, chart cursor readout changes, and narrow selection remains visible", () => {
  const state = createUsageView(), saved = { ...state };
  const page = renderUsageView(data, state, 80, 24, USAGE_NOW);
  assert.deepEqual(state, saved);
  assert.ok(page.state.cursor > 0);
  const latest = page.lines.find(line => line.startsWith("│Nov 2"));
  assert.ok(latest);
  const latestCursor = page.state.cursor;
  handleUsageInput(page.state, "\x1b[D");
  const prior = renderUsageView(data, page.state, 80, 24, USAGE_NOW);
  assert.ok(prior.lines.some(line => line.startsWith("│Nov 1")));
  assert.equal(prior.state.cursor, latestCursor - 1);
  const narrow = renderUsageView(data, state, 30, 16, USAGE_NOW);
  assert.match(narrow.lines.join("\n"), /claude-model/);
});

test("narrow chart axes align and footers drop whole controls before close", () => {
  for (const width of [30, 40, 50]) {
    const page = renderUsageView(data, createUsageView(), width, 16, USAGE_NOW);
    const axes = page.lines.filter(line => line.includes("│"));
    assert.ok(axes.length >= 4);
    assert.equal(new Set(axes.map(line => line.indexOf("│"))).size, 1);
    assert.doesNotMatch(page.lines.at(-1)!, /…/);
    assert.match(page.lines.at(-1)!, /esc close/);
  }
});

test("Limits scroll reaches the last account and keeps fixed selectors/footer", () => {
  const many = { ...data, accounts: Array.from({ length: 32 }, (_, i) => ({ ...data.accounts[0]!, label: `Account ${i}`, id: String(i) })) };
  const state = { ...createUsageView(), tab: "limits" as const, limitScroll: 9999 };
  const page = renderUsageView(many, state, 80, 24, USAGE_NOW);
  assert.match(page.lines.join("\n"), /Account 31/);
  assert.match(page.lines[1]!, /USAGE/);
  assert.match(page.lines.at(-2)!, /close/);
});
test("quota preserves endpoints, expires readings, and has a width ladder", () => {
  const full = quotaSegment(data, 200, USAGE_NOW);
  assert.match(full, /Codex 1/); assert.match(full, /~Codex 2/); assert.match(full, /Claude 2/);
  assert.equal(quotaSegment(data, 5, USAGE_NOW), "");
  const expired = { ...data, accounts: [{ ...data.accounts[0]!, windows: [{ ...data.accounts[0]!.windows[0]!, resetAt: USAGE_NOW - 1 }] }] };
  assert.match(quotaSegment(expired, 80, USAGE_NOW), /\?\?\?\?\?/);
});

test("the chart cursor sits under the middle of its bar", () => {
  const data = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
  for (const width of [80, 160, 200]) {
    const lines = renderUsageView(data, createUsageView(), width, 48, USAGE_NOW).lines.map(stripAnsi);
    const axis = lines.findIndex(line => line.includes("▲") && line.includes("─"));
    const caret = [...lines[axis]!].indexOf("▲");
    const row = [...lines[axis - 1]!], bar = (i: number) => row[i] === "█" || row[i] === "░";
    assert.ok(bar(caret), `bar above caret at ${width}`);
    let left = caret, right = caret;
    while (bar(left - 1)) left--;
    while (bar(right + 1)) right++;
    assert.ok(Math.abs((left + right) / 2 - caret) <= 0.5, `caret centered at ${width}`);
  }
});
