import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "./atomic-json.js";
import { plainTerminalText } from "./terminal-text.js";

export interface UsageWindow { id: string; label: string; remainingPercent: number; resetAt?: number; durationMs?: number }
export interface UsageAccount { producer: string; id: string; provider: string; label: string; plan?: string; checkedAt?: number; fetchedAt?: number; error?: string; resetCredits?: number; windows: UsageWindow[] }
export interface UsageRow { provider: string; model: string; messages: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; estimatedCost: number | null; cacheSavings?: number | null }
export interface UsageDaily extends UsageRow { day: string }
export interface UsageHourly extends UsageRow { hour: number }
export interface UsageProject { day: string; project: string; sessions: number; messages: number; tokens: number; cost: number; estimatedCost: number | null }
export interface UsageHistory { generatedAt: number; source: string; timeZone: string; firstDay?: string; providers: { id: string; label: string }[]; daily: UsageDaily[]; hourly: UsageHourly[]; projects: UsageProject[] }
export interface UsageSnapshot { version: 1; producer: string; updatedAt: number; accounts: UsageAccount[]; history?: UsageHistory }
export interface UsageData { accounts: UsageAccount[]; histories: UsageHistory[]; producers: string[]; updatedAt?: number; hiddenTimeZones: number }
export type UsageCache = Map<string, { mtimeMs: number; size: number; snapshot?: UsageSnapshot }>;
export type UsagePeriod = "24h" | "7d" | "30d" | "90d" | "all";
export type UsageMetric = "cost" | "tokens";
export type UsageBreakdown = "models" | "providers" | "projects";
export const USAGE_PERIODS: UsagePeriod[] = ["24h", "7d", "30d", "90d", "all"];
const DAY = 86400000;
const HOUR = 3600000;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
function text(v: unknown, max = 80): string | undefined { if (typeof v !== "string") return; return plainTerminalText(v).trim().slice(0, max) || undefined; }
function timestamp(v: unknown, now: number): number | undefined { return number(v) && v >= Date.UTC(2000, 0, 1) && v <= now + 400 * DAY ? v : undefined; }
function day(v: unknown): v is string { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
function rows<T>(v: unknown, cap: number, parse: (v: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, cap).flatMap(item => record(item) ? parse(item) ?? [] : []);
}
function cost(v: Record<string, unknown>): boolean { return number(v.cost) && (v.estimatedCost === null || number(v.estimatedCost)); }
function usageRow(v: Record<string, unknown>): UsageRow | undefined {
  const provider = text(v.provider, 120), model = text(v.model, 120);
  if (!provider || !model || !cost(v) || ![v.messages, v.input, v.output, v.cacheRead, v.cacheWrite].every(number)) return;
  return { provider, model, messages: v.messages as number, input: v.input as number, output: v.output as number, cacheRead: v.cacheRead as number, cacheWrite: v.cacheWrite as number, cost: v.cost as number, estimatedCost: v.estimatedCost as number | null,
    ...(v.cacheSavings === null || number(v.cacheSavings) ? { cacheSavings: v.cacheSavings } : {}) };
}
export function parseUsageSnapshot(value: unknown, now = Date.now()): UsageSnapshot | undefined {
  if (!record(value) || value.version !== 1) return;
  const producer = text(value.producer), updatedAt = timestamp(value.updatedAt, now);
  if (!producer || updatedAt === undefined) return;
  const accounts = rows(value.accounts, 32, v => {
    const id = text(v.id), provider = text(v.provider, 120), label = text(v.label);
    if (!id || !provider || !label) return;
    return { producer, id, provider, label, plan: text(v.plan, 40), error: text(v.error, 150), checkedAt: timestamp(v.checkedAt, now), fetchedAt: timestamp(v.fetchedAt, now), resetCredits: number(v.resetCredits) ? v.resetCredits : undefined,
      windows: rows(v.windows, 8, w => {
        const id = text(w.id), label = text(w.label);
        if (!id || !label || !number(w.remainingPercent)) return;
        return { id, label, remainingPercent: Math.min(100, w.remainingPercent), resetAt: timestamp(w.resetAt, now), durationMs: number(w.durationMs) && w.durationMs > 0 ? w.durationMs : undefined };
      }) };
  });
  let history: UsageHistory | undefined;
  if (record(value.history)) {
    const v = value.history, generatedAt = timestamp(v.generatedAt, now), source = text(v.source, 1024), timeZone = text(v.timeZone, 120);
    let validZone = false;
    if (timeZone) { try { new Intl.DateTimeFormat("en", { timeZone }).format(now); validZone = true; } catch (error) { if (!(error instanceof RangeError)) throw error; } }
    if (generatedAt !== undefined && source && timeZone && validZone) {
      const validDay = (v: unknown): v is string => day(v) && timestamp(Date.parse(v), now) !== undefined;
      history = { generatedAt, source, timeZone, firstDay: validDay(v.firstDay) ? v.firstDay : undefined,
        providers: rows(v.providers, 64, p => { const id = text(p.id, 120), label = text(p.label); return id && label ? { id, label } : undefined; }),
        daily: rows(v.daily, 50000, r => { const row = usageRow(r); return row && validDay(r.day) ? { ...row, day: r.day } : undefined; }),
        hourly: rows(v.hourly, 10000, r => { const row = usageRow(r), hour = timestamp(r.hour, now); return row && hour !== undefined && hour % HOUR === 0 ? { ...row, hour } : undefined; }),
        projects: rows(v.projects, 20000, r => { const project = text(r.project, 1024); return project && validDay(r.day) && cost(r) && [r.sessions, r.messages, r.tokens].every(number) ? { day: r.day, project, sessions: r.sessions as number, messages: r.messages as number, tokens: r.tokens as number, cost: r.cost as number, estimatedCost: r.estimatedCost as number | null } : undefined; }),
      };
    }
  }
  return { version: 1, producer, updatedAt, accounts, ...(history ? { history } : {}) };
}
export function mergeUsageSnapshots(snapshots: readonly UsageSnapshot[]): UsageData {
  const accounts = new Map<string, UsageAccount>(), sources = new Map<string, UsageHistory>();
  for (const snapshot of snapshots) {
    for (const account of snapshot.accounts) {
      const key = `${account.producer}\0${account.id}`, previous = accounts.get(key);
      if (!previous || (account.fetchedAt ?? 0) > (previous.fetchedAt ?? 0) || ((account.fetchedAt ?? 0) === (previous.fetchedAt ?? 0) && (account.checkedAt ?? 0) > (previous.checkedAt ?? 0))) accounts.set(key, account);
    }
    const history = snapshot.history;
    if (history && (!sources.has(history.source) || history.generatedAt > sources.get(history.source)!.generatedAt)) sources.set(history.source, history);
  }
  const histories = [...sources.values()].sort((a, b) => b.generatedAt - a.generatedAt);
  const kept = histories.filter(h => h.timeZone === histories[0]?.timeZone);
  return { accounts: [...accounts.values()], histories: kept, producers: [...new Set(snapshots.map(s => s.producer))], updatedAt: snapshots.length ? Math.max(...snapshots.map(s => s.updatedAt)) : undefined, hiddenTimeZones: histories.length - kept.length };
}
export async function readUsageDir(dir: string, cache: UsageCache, now = Date.now()): Promise<UsageData> {
  let names: string[];
  try { names = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && !e.name.startsWith(".") && e.name.endsWith(".json")).map(e => e.name).sort().slice(0, 16); }
  catch (error) { if (!isErrno(error, "ENOENT")) throw error; cache.clear(); return mergeUsageSnapshots([]); }
  for (const name of cache.keys()) if (!names.includes(name)) cache.delete(name);
  for (const name of names) {
    try {
      const path = join(dir, name), info = await stat(path), old = cache.get(name);
      if (old?.mtimeMs === info.mtimeMs && old.size === info.size) continue;
      let snapshot: UsageSnapshot | undefined;
      if (info.size <= 32 * 1024 * 1024) {
        const content = await readFile(path, "utf8");
        try { snapshot = parseUsageSnapshot(JSON.parse(content), now); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      cache.set(name, { mtimeMs: info.mtimeMs, size: info.size, snapshot });
    } catch (error) { if (!isErrno(error, "ENOENT")) throw error; cache.delete(name); }
  }
  return mergeUsageSnapshots([...cache.values()].flatMap(e => e.snapshot ?? []));
}
export function accountStale(account: UsageAccount, now: number): boolean { return Boolean(account.error) || account.fetchedAt === undefined || now - account.fetchedAt > 900000; }
export function windowExpired(window: UsageWindow, now: number): boolean { return window.resetAt !== undefined && window.resetAt <= now; }
export function usagePace(window: UsageWindow, now: number): { kind: "on" | "ahead" | "under"; expectedRemaining: number; runOutAt?: number } | undefined {
  if (!window.durationMs || !window.resetAt || window.resetAt <= now) return;
  const elapsed = Math.max(0, Math.min(1, 1 - (window.resetAt - now) / window.durationMs)), used = 1 - window.remainingPercent / 100;
  const kind = used > elapsed + 0.05 ? "ahead" : used < elapsed - 0.05 ? "under" : "on";
  const runOutAt = used > 0 && elapsed > 0 ? now + window.durationMs * elapsed * (1 - used) / used : undefined;
  return { kind, expectedRemaining: 1 - elapsed, ...(runOutAt !== undefined && runOutAt < window.resetAt ? { runOutAt } : {}) };
}
export interface UsageTotal { value: number; tokens: number; recorded: number; estimated: number; input: number; output: number; cacheRead: number; cacheWrite: number; messages: number; savings?: number; cacheHit: number }
export interface UsageBucket { key: string; endKey?: string; total: number; values: Record<string, number> }
export interface UsageBreakdownRow extends UsageTotal { name: string; provider?: string; sessions: number; unpriced: boolean; buckets: number[] }
export interface UsageAggregation { total: UsageTotal; delta?: number; activeDays: number; streak: number; unpriced: number; breakdown: UsageBreakdownRow[]; buckets: UsageBucket[]; providerLabels: ReadonlyMap<string, string>; dailyActivity: { day: string; tokens: number }[] }
function emptyTotal(): UsageTotal { return { value: 0, tokens: 0, recorded: 0, estimated: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0, cacheHit: 0 }; }
function add(total: UsageTotal, row: UsageRow | UsageProject, metric: UsageMetric): void {
  const tokens = "input" in row ? row.input + row.output + row.cacheRead + row.cacheWrite : row.tokens;
  total.tokens += tokens; total.recorded += row.cost; total.estimated += row.estimatedCost ?? row.cost; total.messages += row.messages;
  total.value += metric === "tokens" ? tokens : row.estimatedCost ?? row.cost;
  if ("input" in row) { total.input += row.input; total.output += row.output; total.cacheRead += row.cacheRead; total.cacheWrite += row.cacheWrite;
    if (row.cacheSavings !== undefined && row.cacheSavings !== null) total.savings = (total.savings ?? 0) + row.cacheSavings;
  }
  const denominator = total.input + total.cacheRead + total.cacheWrite;
  total.cacheHit = denominator ? total.cacheRead / denominator : 0;
}
function usageDay(now: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-");
}
export function mergeUsageBuckets(buckets: UsageBucket[], width: number): UsageBucket[] {
  const count = Math.max(1, Math.min(buckets.length, Math.floor(width)));
  if (buckets.length <= count) return buckets;
  return Array.from({ length: count }, (_, i) => {
    const group = buckets.slice(Math.floor(i * buckets.length / count), Math.floor((i + 1) * buckets.length / count));
    const values: Record<string, number> = Object.create(null);
    for (const bucket of group) for (const [id, value] of Object.entries(bucket.values)) values[id] = (values[id] ?? 0) + value;
    return { key: group[0]!.key, endKey: group.at(-1)!.endKey ?? group.at(-1)!.key, total: group.reduce((sum, b) => sum + b.total, 0), values };
  });
}
export function aggregateUsage(data: UsageData, period: UsagePeriod, metric: UsageMetric, breakdown: UsageBreakdown, now = Date.now()): UsageAggregation {
  const zone = data.histories[0]?.timeZone ?? "UTC";
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = usageDay(now, formatter), todayMs = Date.parse(today);
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : Infinity;
  const start = period === "24h" ? Math.floor(now / HOUR) * HOUR - 23 * HOUR : todayMs - (days - 1) * DAY;
  const end = period === "24h" ? Math.floor(now / HOUR) * HOUR + HOUR : todayMs + DAY;
  const span = end - start;
  const source: (UsageDaily | UsageHourly)[] = data.histories.flatMap<UsageDaily | UsageHourly>(h => period === "24h" ? h.hourly : h.daily);
  const time = (r: UsageDaily | UsageHourly) => "hour" in r ? r.hour : Date.parse(r.day);
  const current = source.filter(r => time(r) >= start && time(r) < end), previous = source.filter(r => time(r) >= start - span && time(r) < start);
  const total = emptyTotal(), prior = emptyTotal();
  for (const row of current) add(total, row, metric);
  for (const row of previous) add(prior, row, metric);
  const labels = new Map<string, string>();
  for (const h of data.histories) for (const p of h.providers) if (!labels.has(p.id)) labels.set(p.id, p.label);
  const bucketKey = (time: number) => period === "24h" ? String(time) : new Date(period === "all" ? time - ((new Date(time).getUTCDay() + 6) % 7) * DAY : time).toISOString().slice(0, 10);
  const actualStart = Number.isFinite(start) ? start : current.length ? current.reduce((min, row) => Math.min(min, time(row)), Infinity) : todayMs;
  const bucketMap = new Map<string, UsageBucket>();
  for (let t = actualStart; t < end; t += period === "24h" ? HOUR : DAY) { const key = bucketKey(t); if (!bucketMap.has(key)) bucketMap.set(key, { key, total: 0, values: Object.create(null) }); }
  for (const row of current) {
    bucketMap.get(bucketKey(time(row)))!.total += metric === "tokens" ? row.input + row.output + row.cacheRead + row.cacheWrite : row.estimatedCost ?? row.cost;
  }
  const buckets = [...bucketMap.values()], keys = buckets.map(b => b.key);
  const byName = new Map<string, UsageBreakdownRow>();
  const projects = period === "24h" ? [] : data.histories.flatMap(h => h.projects).filter(r => Date.parse(r.day) >= start && Date.parse(r.day) < end);
  for (const row of breakdown === "projects" ? projects : current) {
    const name = "project" in row ? row.project : breakdown === "models" ? row.model : row.provider;
    const key = "project" in row || breakdown !== "models" ? name : `${row.provider}\0${row.model}`;
    let target = byName.get(key);
    if (!target) { target = { ...emptyTotal(), name, provider: "provider" in row ? row.provider : undefined, sessions: 0, unpriced: true, buckets: keys.map(() => 0) }; byName.set(key, target); }
    add(target, row, metric); target.unpriced &&= row.estimatedCost === null;
    if ("sessions" in row) target.sessions += row.sessions;
    const index = keys.indexOf(bucketKey("hour" in row ? row.hour : Date.parse(row.day)));
    if (index >= 0) target.buckets[index]! += metric === "tokens" ? ("tokens" in row ? row.tokens : row.input + row.output + row.cacheRead + row.cacheWrite) : row.estimatedCost ?? row.cost;
  }
  const sorted = [...byName.values()].sort((a, b) => (metric === "cost" ? Number(a.unpriced) - Number(b.unpriced) : 0) || b.value - a.value || (metric === "cost" ? b.tokens - a.tokens : b.estimated - a.estimated) || a.name.localeCompare(b.name));
  const activity = new Map<string, number>();
  for (const h of data.histories) for (const row of h.daily) if (row.messages > 0) activity.set(row.day, (activity.get(row.day) ?? 0) + row.input + row.output + row.cacheRead + row.cacheWrite);
  let streak = 0, cursor = todayMs;
  if (!activity.has(today)) cursor -= DAY;
  while (activity.has(new Date(cursor).toISOString().slice(0, 10))) { streak++; cursor -= DAY; }
  const unpriced = new Set(current.filter(r => r.estimatedCost === null).map(r => `${r.provider}\0${r.model}`)).size;
  const activeDays = new Set<string>(), activeHours = new Set<number>();
  for (const row of current) {
    if (row.messages <= 0) continue;
    if ("day" in row) activeDays.add(row.day);
    else activeHours.add(row.hour);
  }
  for (const hour of activeHours) activeDays.add(usageDay(hour, formatter));
  return { total, delta: prior.value > 0 ? (total.value - prior.value) / prior.value : undefined, activeDays: activeDays.size, streak, unpriced, breakdown: sorted, buckets, providerLabels: labels, dailyActivity: [...activity].filter(([day]) => Date.parse(day) >= actualStart && Date.parse(day) < end).map(([day, tokens]) => ({ day, tokens })).sort((a, b) => a.day.localeCompare(b.day)) };
}
