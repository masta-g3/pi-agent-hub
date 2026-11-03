import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsageSnapshot, mergeUsageSnapshots, readUsageDir, aggregateUsage, usagePace, accountStale, mergeUsageBuckets } from "../src/core/usage.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";

test("usage validates independent sections, sanitizes text and drops bad rows", () => {
  assert.equal(parseUsageSnapshot({ ...usageFixture(), version: 2 }, USAGE_NOW), undefined);
  const raw = usageFixture();
  raw.accounts[0]!.label = "\x1b[31mCodex\x1b[0m\n1";
  raw.accounts[0]!.windows[0]!.remainingPercent = 150;
  const parsed = parseUsageSnapshot(raw, USAGE_NOW)!;
  assert.equal(parsed.accounts[0]!.label, "Codex 1");
  assert.equal(parsed.accounts[0]!.windows[0]!.remainingPercent, 100);
  assert.equal(parseUsageSnapshot({ ...raw, history: { ...raw.history, timeZone: "not/a-zone" } }, USAGE_NOW)!.history, undefined);
  assert.equal(parseUsageSnapshot({ ...raw, accounts: "bad" }, USAGE_NOW)!.history!.daily.length, raw.history.daily.length);
  const history = parseUsageSnapshot({ ...raw, history: { ...raw.history, daily: [...raw.history.daily, { day: "bad" }] } }, USAGE_NOW)!.history!;
  assert.equal(history.daily.length, raw.history.daily.length);
  assert.equal(history.daily.at(-1)!.estimatedCost, null);
  assert.equal(parseUsageSnapshot({ ...raw, updatedAt: 1 }, USAGE_NOW), undefined);
  const window = parseUsageSnapshot({ ...raw, accounts: [{ ...raw.accounts[0], windows: [{ ...raw.accounts[0]!.windows[0], durationMs: 0 }] }] }, USAGE_NOW)!.accounts[0]!.windows[0]!;
  assert.equal(window.durationMs, undefined);
});

test("usage caps rows and validates dates and numeric fields", () => {
  const raw = usageFixture();
  const parsed = parseUsageSnapshot({ ...raw, accounts: Array(40).fill({ ...raw.accounts[0], windows: Array(12).fill(raw.accounts[0]!.windows[0]) }), history: { ...raw.history, daily: Array(50001).fill(raw.history.daily[0]) } }, USAGE_NOW)!;
  assert.equal(parsed.accounts.length, 32);
  assert.equal(parsed.accounts[0]!.windows.length, 8);
  assert.equal(parsed.history!.daily.length, 50000);
  assert.equal(parseUsageSnapshot({ ...raw, history: { ...raw.history, daily: [{ ...raw.history.daily[0], day: "2026-02-30" }, { ...raw.history.daily[0], input: -1 }] } }, USAGE_NOW)!.history!.daily.length, 0);
});

test("merge deduplicates source histories and account identities, hides other time zones", () => {
  const a = parseUsageSnapshot(usageFixture(), USAGE_NOW)!;
  const b = parseUsageSnapshot({ ...usageFixture(), accounts: [{ ...usageFixture().accounts[0], fetchedAt: USAGE_NOW - 1000 }], history: { ...usageFixture().history, generatedAt: USAGE_NOW - 1000 } }, USAGE_NOW)!;
  const other = parseUsageSnapshot({ ...usageFixture(), history: { ...usageFixture().history, source: "other", timeZone: "Europe/London", generatedAt: USAGE_NOW - 2000 } }, USAGE_NOW)!;
  const data = mergeUsageSnapshots([a, b, other]);
  assert.equal(data.accounts.length, a.accounts.length);
  assert.equal(data.accounts[0]!.fetchedAt, USAGE_NOW - 1000);
  assert.equal(data.histories.length, 1);
  assert.equal(data.hiddenTimeZones, 1);
  assert.equal(accountStale(data.accounts[0]!, USAGE_NOW), false);
  assert.equal(accountStale({ ...data.accounts[0]!, error: "login" }, USAGE_NOW), true);
  assert.equal(accountStale({ ...data.accounts[0]!, fetchedAt: undefined }, USAGE_NOW), true);
});

test("reader gates parsing by mtime and size, ignores dot files, oversize and excess files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-usage-"));
  try {
    const cache = new Map();
    await writeFile(join(dir, "a.json"), JSON.stringify(usageFixture()));
    await writeFile(join(dir, ".hidden.json"), JSON.stringify(usageFixture()));
    const a = await readUsageDir(dir, cache, USAGE_NOW);
    const cached = cache.get("a.json");
    await readUsageDir(dir, cache, USAGE_NOW);
    assert.equal(cache.get("a.json"), cached);
    assert.equal(a.histories.length, 1);
    await writeFile(join(dir, "a.json"), "{}");
    await utimes(join(dir, "a.json"), new Date(), new Date(Date.now() + 1000));
    assert.equal((await readUsageDir(dir, cache, USAGE_NOW)).histories.length, 0);
    for (let n = 0; n < 17; n++) await writeFile(join(dir, `b${String(n).padStart(2, "0")}.json`), JSON.stringify({ ...usageFixture(), history: { ...usageFixture().history, source: `source${n}` } }));
    assert.equal((await readUsageDir(dir, cache, USAGE_NOW)).histories.length, 15);
    await writeFile(join(dir, "a.json"), " ".repeat(32 * 1024 * 1024 + 1));
    assert.equal((await readUsageDir(dir, cache, USAGE_NOW)).histories.length, 15);
    await rm(dir, { recursive: true });
    assert.equal((await readUsageDir(dir, cache, USAGE_NOW)).accounts.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("aggregation keeps exact totals, periods, cache, row buckets, projects and null pricing", () => {
  const data = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
  const all = aggregateUsage(data, "all", "cost", "models", USAGE_NOW);
  const rows = usageFixture().history.daily;
  assert.equal(all.total.tokens, rows.reduce((n, r) => n + r.input + r.output + r.cacheRead + r.cacheWrite, 0));
  assert.equal(all.total.value, rows.reduce((n, r) => n + (r.estimatedCost ?? r.cost), 0));
  assert.equal(all.total.recorded, rows.reduce((n, r) => n + r.cost, 0));
  assert.equal(all.unpriced, 1);
  assert.equal(all.breakdown.at(-1)!.name, "unknown-model");
  for (const kind of ["models", "providers"] as const) {
    const agg = aggregateUsage(data, "30d", "cost", kind, USAGE_NOW);
    agg.buckets.forEach((bucket, i) => assert.ok(Math.abs(agg.breakdown.reduce((n, r) => n + r.buckets[i]!, 0) - bucket.total) < 1e-9));
  }
  assert.equal(aggregateUsage(data, "24h", "tokens", "models", USAGE_NOW).total.messages, 24);
  assert.equal(aggregateUsage(data, "24h", "tokens", "projects", USAGE_NOW).breakdown.length, 0);
  assert.equal(aggregateUsage(data, "7d", "cost", "projects", USAGE_NOW).breakdown[0]!.sessions, 7);
  assert.equal(aggregateUsage(data, "7d", "tokens", "providers", USAGE_NOW).activeDays, 7);
  assert.equal(aggregateUsage(data, "7d", "cost", "models", USAGE_NOW).delta, 0);
  const merged = mergeUsageBuckets(all.buckets, 3);
  assert.equal(merged.length, 3);
  assert.equal(merged.reduce((n, b) => n + b.total, 0), all.buckets.reduce((n, b) => n + b.total, 0));
});

test("period boundaries use source time zone and recorded cost stays independent of estimates", () => {
  const raw = usageFixture();
  const data = mergeUsageSnapshots([parseUsageSnapshot({ ...raw, history: { ...raw.history, timeZone: "America/Los_Angeles" } }, USAGE_NOW)!]);
  const week = aggregateUsage(data, "7d", "cost", "models", Date.UTC(2026, 10, 2, 2));
  assert.equal(week.buckets.at(-1)!.key, "2026-11-01");
  assert.equal(week.buckets[0]!.key, "2026-10-26");
  const expected = raw.history.daily.filter(row => row.day >= "2026-10-26" && row.day <= "2026-11-01").reduce((n, row) => n + (row.estimatedCost ?? row.cost), 0);
  assert.equal(week.total.value, expected);
  const priced = { ...raw.history.daily[0]!, day: "2026-11-02", estimatedCost: 10, cost: 1 };
  const unpriced = { ...priced, model: "unpriced", estimatedCost: null, cost: 3 };
  const mixed = aggregateUsage(mergeUsageSnapshots([parseUsageSnapshot({ ...raw, history: { ...raw.history, daily: [priced, unpriced] } }, USAGE_NOW)!]), "7d", "cost", "models", USAGE_NOW);
  assert.equal(mixed.total.value, 13);
  assert.equal(mixed.total.recorded, 4);
  assert.equal(mixed.total.cacheHit, priced.cacheRead / (priced.input + priced.cacheRead + priced.cacheWrite));
  assert.equal(mixed.breakdown.at(-1)!.name, "unpriced");
  const providers = aggregateUsage(mergeUsageSnapshots([parseUsageSnapshot({ ...raw, history: { ...raw.history, daily: [priced, unpriced] } }, USAGE_NOW)!]), "7d", "cost", "providers", USAGE_NOW);
  assert.equal(providers.breakdown[0]!.unpriced, false);
  assert.equal(providers.breakdown[0]!.estimated, 13);
});

test("hourly active days format distinct hours without rebuilding a formatter per row", () => {
  const raw = usageFixture();
  const hourly = Array.from({ length: 10000 }, (_, index) => ({ ...raw.history.hourly[0]!, hour: USAGE_NOW - (index % 2) * 12 * 3600000 }));
  const data = mergeUsageSnapshots([parseUsageSnapshot({ ...raw, history: { ...raw.history, timeZone: "America/Los_Angeles", hourly } }, USAGE_NOW)!]);
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) { constructions++; return Reflect.construct(target, args); } });
  try {
    const result = aggregateUsage(data, "24h", "tokens", "models", USAGE_NOW);
    assert.equal(result.activeDays, 2);
    assert.equal(result.total.messages, 10000);
    assert.ok(constructions <= 2, `constructed ${constructions} date formatters for 10,000 rows`);
  } finally { Intl.DateTimeFormat = original; }
});

test("producer strings cannot inject controls or collide with object properties", () => {
  const raw = usageFixture();
  const controls = "\x1b]52;c;ZXZpbA==\x07\x1b[31m safe \x1b[0m";
  const parsed = parseUsageSnapshot({ ...raw, producer: controls, accounts: [{ ...raw.accounts[0], id: controls, provider: controls, label: controls, plan: controls, error: controls, windows: [{ ...raw.accounts[0]!.windows[0], id: controls, label: controls }] }], history: { ...raw.history, source: controls, providers: [{ id: controls, label: controls }], daily: [{ ...raw.history.daily[0], provider: "__proto__", model: controls }], projects: [{ ...raw.history.projects[0], project: controls }] } }, USAGE_NOW)!;
  assert.doesNotMatch(JSON.stringify(parsed), /\\\\u001b|ZXZpbA|\\\\u0007/);
  const all = aggregateUsage(mergeUsageSnapshots([parsed]), "all", "cost", "providers", USAGE_NOW);
  assert.equal(all.total.value, 10);
  assert.equal(all.buckets.reduce((n, bucket) => n + bucket.total, 0), 10);
  assert.equal(all.breakdown.length, 1);
  assert.equal(all.breakdown[0]!.buckets.reduce((n, value) => n + value, 0), 10);
});

test("pace distinguishes expected use, projects early exhaustion and ignores expired windows", () => {
  const window = { id: "5h", label: "5h", resetAt: USAGE_NOW + 50, durationMs: 100, remainingPercent: 50 };
  assert.equal(usagePace(window, USAGE_NOW)!.kind, "on");
  assert.equal(usagePace({ ...window, remainingPercent: 80 }, USAGE_NOW)!.kind, "under");
  assert.equal(usagePace({ ...window, remainingPercent: 10 }, USAGE_NOW)!.kind, "ahead");
  assert.ok(usagePace({ ...window, remainingPercent: 10 }, USAGE_NOW)!.runOutAt! < window.resetAt);
  assert.equal(usagePace({ ...window, durationMs: undefined }, USAGE_NOW), undefined);
  assert.equal(usagePace({ ...window, resetAt: USAGE_NOW }, USAGE_NOW), undefined);
});
