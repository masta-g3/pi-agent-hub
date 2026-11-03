import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { accountStale, aggregateUsage, mergeUsageBuckets, USAGE_PERIODS, usagePace, windowExpired, type UsageAccount, type UsageAggregation, type UsageBreakdown, type UsageBreakdownRow, type UsageData, type UsagePeriod, type UsageWindow } from "../core/usage.js";
import { usageDir } from "../core/paths.js";
import { ageLabel } from "./age.js";
import type { DialogHit } from "./dialog-mouse.js";
import { glyphs } from "./glyphs.js";
import { noColor, styleBgToken, styleToken, type SessionsTheme, type ThemeToken } from "./theme.js";

export interface UsageViewState { tab: "cost" | "tokens" | "limits"; period: UsagePeriod; breakdown: UsageBreakdown; selected: number; detail: boolean; cursor: number; limitScroll: number }
export function createUsageView(): UsageViewState { return { tab: "cost", period: "30d", breakdown: "models", selected: 0, detail: false, cursor: -1, limitScroll: 0 }; }
const fit = (s: string, w: number) => truncateToWidth(s, Math.max(0, w), glyphs.ellipsis);
const pad = (s: string, w: number) => fit(s, w) + " ".repeat(Math.max(0, w - visibleWidth(fit(s, w))));
const right = (s: string, w: number) => " ".repeat(Math.max(0, w - visibleWidth(s))) + s;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
function paint(theme: SessionsTheme | undefined, token: ThemeToken, value: string): string { return theme ? styleToken(theme, token, value) : value; }
export function usageTokens(n: number): string { return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)); }
const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const approx = (n: number) => `${glyphs.approximate}${dollars(n)}`;
function updatedAge(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) return "at an unknown time";
  const age = ageLabel(Math.max(0, now - timestamp), "now");
  return age === "now" ? "just now" : `${age} ago`;
}
export function usageCountdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
function resetTime(time: number, now: number): string { return new Intl.DateTimeFormat("en", { ...(time - now > 86400000 ? { weekday: "short" as const } : {}), hour: "2-digit", minute: "2-digit", hour12: false }).format(time); }
const quotaTone = (percent: number): ThemeToken => percent > 25 ? "success" : percent > 0 ? "warning" : "error";
function quotaBar(window: UsageWindow, width: number, now: number, theme?: SessionsTheme, stale = false, mark = false): string {
  if (windowExpired(window, now)) return paint(theme, "muted", "?".repeat(width));
  const percent = window.remainingPercent;
  const fill = percent <= 0 ? 0 : percent >= 100 ? width : Math.min(width - 1, Math.max(1, Math.round(percent / 100 * width)));
  const pace = mark ? usagePace(window, now) : undefined;
  const tick = pace ? Math.min(width - 1, Math.max(0, Math.round(pace.expectedRemaining * width))) : -1;
  return Array.from({ length: width }, (_, i) => i === tick ? bold(paint(theme, "text", glyphs.attentionBar)) : paint(theme, i < fill && !stale ? quotaTone(percent) : "muted", i < fill ? glyphs.quotaFilled : glyphs.quotaEmpty)).join("");
}
function constrainedWindow(account: UsageAccount): UsageWindow[] { return account.windows.length ? [account.windows.reduce((a, b) => b.remainingPercent < a.remainingPercent ? b : a)] : []; }
export function quotaSegment(data: UsageData | undefined, width: number, now: number, theme?: SessionsTheme): string {
  if (!data?.accounts.length) return "";
  const chip = (a: UsageAccount, windows: UsageWindow[]) => {
    const stale = accountStale(a, now);
    const label = paint(theme, "muted", `${stale && a.windows.length ? "~" : ""}${a.label}`);
    if (!a.windows.length) return a.error ? `${label} ${paint(theme, "warning", glyphs.warning)}` : label;
    return label + windows.map(w => ` ${paint(theme, "muted", w.label)}${quotaBar(w, 5, now, theme, stale)}${w.remainingPercent <= 25 && w.resetAt && !windowExpired(w, now) ? ` ${paint(theme, stale ? "muted" : quotaTone(w.remainingPercent), usageCountdown(w.resetAt - now))}` : ""}`).join("");
  };
  const worst = data.accounts.reduce((a, b) => {
    const severity = (a: UsageAccount) => Math.min(...a.windows.map(w => w.remainingPercent), 101);
    return severity(b) < severity(a) ? b : a;
  });
  const candidates = [data.accounts.map(a => chip(a, a.windows)).join("   "), data.accounts.map(a => chip(a, constrainedWindow(a))).join("   "), chip(worst, constrainedWindow(worst)) + (data.accounts.length > 1 ? paint(theme, "muted", ` +${data.accounts.length - 1}`) : "")];
  return candidates.find(s => visibleWidth(s) <= width) ?? "";
}
export function handleUsageInput(state: UsageViewState, key: string): boolean {
  if (matchesKey(key, Key.escape) || key === "q" || key === "u") return true;
  const tabs = ["cost", "tokens", "limits"] as const;
  const setTab = (tab: UsageViewState["tab"]) => { state.tab = tab; };
  if (key === "c") setTab("cost"); else if (key === "t") setTab("tokens"); else if (key === "l") setTab("limits");
  else if (matchesKey(key, Key.tab) || matchesKey(key, "shift+tab")) setTab(tabs[(tabs.indexOf(state.tab) + (matchesKey(key, "shift+tab") ? 2 : 1)) % 3]!);
  else if (state.tab === "limits") {
    if (matchesKey(key, Key.down) || matchesKey(key, Key.pageDown)) state.limitScroll += matchesKey(key, Key.pageDown) ? 10 : 1;
    if (matchesKey(key, Key.up) || matchesKey(key, Key.pageUp)) state.limitScroll = Math.max(0, state.limitScroll - (matchesKey(key, Key.pageUp) ? 10 : 1));
  } else {
    const index = USAGE_PERIODS.indexOf(state.period);
    if (key === "[" || key === "]" || /^[1-5]$/.test(key)) {
      state.period = USAGE_PERIODS[/^[1-5]$/.test(key) ? Number(key) - 1 : Math.max(0, Math.min(4, index + (key === "[" ? -1 : 1)))]!;
      state.cursor = -1; state.selected = 0; state.detail = false;
    } else if (key === "b") {
      const kinds: UsageBreakdown[] = state.period === "24h" ? ["models", "providers"] : ["models", "providers", "projects"];
      state.breakdown = kinds[(kinds.indexOf(state.breakdown) + 1) % kinds.length]!; state.selected = 0; state.detail = false;
    } else if (matchesKey(key, Key.down)) { state.selected++; state.detail = false; }
    else if (matchesKey(key, Key.up)) { state.selected = Math.max(0, state.selected - 1); state.detail = false; }
    else if (matchesKey(key, Key.left)) state.cursor = Math.max(0, state.cursor - 1);
    else if (matchesKey(key, Key.right)) state.cursor++;
    else if (key === "\r" || key === "\n") state.detail = !state.detail;
  }
  if (state.period === "24h" && state.breakdown === "projects") state.breakdown = "models";
  return false;
}
/** Largest-remainder rounding keeps a whole-cell stack equal to its rounded total. */
export function stackUsageCells(values: number[], height: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!sum) return values.map(() => 0);
  const exact = values.map(v => v / sum * height), cells = exact.map(Math.floor);
  const order = exact.map((v, i) => ({ i, fraction: v - cells[i]! })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  const remainder = height - cells.reduce((a, b) => a + b, 0);
  for (let n = 0; n < remainder; n++) cells[order[n]!.i]!++;
  return cells;
}
// The chart and share bars show the selected breakdown row against everything else, so they never need more tones than the theme has.
const highlightGlyph = () => glyphs.series[0]!;
const restGlyph = () => glyphs.series[3]!;
function chartDate(key: string, hourly: boolean): string { const d = new Date(hourly ? Number(key) : key); return hourly ? d.toLocaleTimeString("en", { hour: "2-digit", hour12: false }) + "h" : d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }); }
export interface UsagePage { lines: string[]; hits: DialogHit[]; state: UsageViewState }
export function renderUsageView(data: UsageData, state: UsageViewState, width: number, height: number, now: number, theme?: SessionsTheme): UsagePage {
  state = { ...state };
  width = Math.max(30, width); height = Math.max(1, height);
  const inset = width > 60 && height >= 5 ? 1 : 0, w = width - inset * 2, bodyHeight = height - inset * 2;
  const hits: DialogHit[] = [], body: string[] = [];
  const p = (token: ThemeToken, s: string) => paint(theme, token, s);
  const add = (line = "") => { body.push(fit(line, w)); };
  const hit = (row: number, x: number, length: number, id: string, key?: string, select?: DialogHit["select"]) => { if (x < w) hits.push({ row: row + inset, x: x + inset + 1, width: Math.min(length, w - x), id, key, select }); };
  const selector = (label: string, selected: boolean) => selected ? (theme && !noColor() ? styleBgToken(theme, "selectedBg", bold(p("accent", ` ${label} `))) : bold(`[${label}]`)) : p("muted", ` ${label} `);
  let header = p("accent", bold("USAGE")) + "  ";
  for (const [label, tab, key] of [["Cost", "cost", "c"], ["Tokens", "tokens", "t"], ["Limits", "limits", "l"]] as const) { hit(0, visibleWidth(header), label.length + 2, `tab:${tab}`, key); header += selector(label, state.tab === tab); }
  add(header);
  if (state.tab !== "limits") {
    let periods = "";
    for (const [i, period] of USAGE_PERIODS.entries()) { const label = period === "all" ? "All" : period; hit(body.length, visibleWidth(periods), label.length + 2, `period:${period}`, String(i + 1)); periods += selector(label, state.period === period); }
    if (w >= 78) {
      const row = body.pop()!, start = w - visibleWidth(periods);
      for (const h of hits) if (h.id.startsWith("period:")) { h.row--; h.x! += start; }
      add(pad(row, start) + periods);
    } else add(periods);
  }
  add(p("dim", glyphs.horizontal.repeat(w)));
  const footerRow = bodyHeight - 1;
  const footerPairs = state.tab === "limits" ? [["c t l", "tab"], [`${glyphs.up} ${glyphs.down}`, "scroll"], ["esc", "close"]] : [["c t l", "tab"], ["1-5", "period"], [`${glyphs.left} ${glyphs.right}`, "day"], [`${glyphs.up} ${glyphs.down}`, "row"], [glyphs.enter, "details"], ["b", "breakdown"], ["esc", "close"]];
  const empty = !data.accounts.length && !data.histories.length;
  if (empty) {
    for (const line of ["No usage data yet.", "Install pi-accounts and open a Pi session;", "it publishes to", usageDir()]) add(p("muted", line));
  } else if (state.tab === "limits") {
    if (!data.accounts.length) add(p("muted", "No account limits in the snapshot."));
    else {
      const content = renderLimits(data.accounts, w, now, theme);
      const available = Math.max(1, footerRow - body.length - 2);
      state.limitScroll = Math.max(0, Math.min(state.limitScroll, content.length - available));
      for (const line of content.slice(state.limitScroll, state.limitScroll + available)) add(line);
      add(p("muted", `${glyphs.attentionBar} = even pace across the window. ~ = stale; ????? = refresh needed.`));
      add(p("muted", `Updated ${updatedAge(data.updatedAt, now)} ${glyphs.pendingStep} ${data.producers.join(", ")}`));
    }
  } else if (!data.histories.length) add(p("muted", "No usage history in the snapshot. Limits are available."));
  else {
    const agg = aggregateUsage(data, state.period, state.tab, state.breakdown, now);
    const headline = state.tab === "cost" ? `${approx(agg.total.value)} est. API cost` : `${usageTokens(agg.total.tokens)} tokens`;
    const delta = agg.delta === undefined ? "" : `${agg.delta >= 0 ? glyphs.chartCursor : glyphs.deltaDown} ${Math.abs(Math.round(agg.delta * 100))}% vs prior ${state.period}`;
    const cache = `${Math.round(agg.total.cacheHit * 100)}% cache hit` + (agg.total.savings !== undefined ? `  saved ${approx(agg.total.savings)}` : "");
    const tokens = state.tab === "cost" ? `${usageTokens(agg.total.tokens)} tokens  ` : "";
    if (w >= 98) {
      const compact = w < 138;
      const deltaText = compact ? delta.replace("vs prior ", "prior ") : delta;
      const cacheText = compact ? `${Math.round(agg.total.cacheHit * 100)}% cache` + (agg.total.savings !== undefined ? ` ${glyphs.approximate}$${usageTokens(agg.total.savings)} saved` : "") : cache;
      add(`${bold(p("text", headline))}  ${p("muted", deltaText)}  ${p("text", tokens)}${p("muted", cacheText)}  ${p("text", dollars(agg.total.recorded))}${p("muted", " recorded")}${w >= 148 ? p("muted", `  ${agg.activeDays} active days`) : ""}`);
    } else { add(`${bold(p("text", headline))}  ${p("muted", delta)}`); add(`${p("text", tokens)}${p("muted", cache)}  ${p("muted", `${dollars(agg.total.recorded)} recorded`)}`); }
    if (state.tab === "tokens") add(p("muted", `Input ${usageTokens(agg.total.input)}  Output ${usageTokens(agg.total.output)}  Cache read ${usageTokens(agg.total.cacheRead)}  Write ${usageTokens(agg.total.cacheWrite)}`));
    const age = updatedAge(data.updatedAt, now);
    const note = w >= 98 ? `Estimated from API list prices by ${data.producers.join(", ")}; not your bill. ${agg.unpriced ? `${agg.unpriced} ${agg.unpriced === 1 ? "model" : "models"} unpriced. ` : ""}Updated ${age}.` : `API estimate; not your bill. ${agg.unpriced ? `${agg.unpriced} unpriced. ` : ""}Updated ${age}.`;
    add(p("muted", note));
    if (data.hiddenTimeZones) add(p("muted", `${data.hiddenTimeZones} history sources hidden: different time zone.`));
    const remaining = footerRow - body.length;
    const chartHeight = Math.max(3, Math.min(8, remaining - 8));
    state.selected = Math.max(0, Math.min(state.selected, agg.breakdown.length - 1));
    if (height >= 24) add(p("muted", `${state.period === "24h" ? "Hourly" : state.period === "all" ? "Weekly" : "Daily"} ${state.tab === "cost" ? "estimated cost" : "tokens"}`));
    renderChart(agg, agg.breakdown[state.selected], state, w, chartHeight, theme, add, hit, body.length);
    if (state.tab === "tokens" && height >= 34 && (state.period === "90d" || state.period === "all") && footerRow - body.length >= 13) {
      add(p("muted", `Activity ${glyphs.pendingStep} ${agg.streak}-day streak`));
      const activity = new Map(agg.dailyActivity.map(d => [d.day, d.tokens]));
      const max = Math.max(1, ...activity.values());
      const today = agg.dailyActivity.at(-1)?.day;
      const end = today ? Date.parse(today) : now;
      const weeks = Math.min(w - 4, state.period === "90d" ? 13 : 52);
      const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * 86400000;
      for (let d = 0; d < 7; d++) add(p("muted", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]! + " ") + Array.from({ length: weeks }, (_, i) => { const date = new Date(monday - (weeks - 1 - i) * 604800000 + d * 86400000).toISOString().slice(0, 10), n = activity.get(date) ?? 0; return p(n ? "accent" : "muted", glyphs.heatmap[n ? Math.max(1, Math.ceil(n / max * 4)) : 0]!); }).join(""));
    }
    let labels = p("muted", "Breakdown ");
    for (const kind of ["models", "providers", "projects"] as const) {
      const label = kind[0]!.toUpperCase() + kind.slice(1), disabled = kind === "projects" && state.period === "24h";
      if (!disabled) hit(body.length, visibleWidth(labels), label.length + 2, `breakdown:${kind}`, undefined, ctx => { state.breakdown = kind; state.selected = 0; state.detail = false; return ctx.dialog(); });
      labels += selector(label, state.breakdown === kind) + (disabled ? p("muted", "daily data") : "");
    }
    add(labels);
    if (w >= 98) add(tableRow(undefined, false, agg, w, theme, state.tab));
    const detailLines = state.detail && agg.breakdown[state.selected] ? rowDetails(agg.breakdown[state.selected]!, state.breakdown, w, theme).slice(0, Math.max(1, footerRow - body.length - 1)) : [];
    const slots = Math.max(1, footerRow - body.length - detailLines.length);
    const offset = Math.max(0, state.selected - slots + 1);
    for (let i = offset; i < Math.min(agg.breakdown.length, offset + slots); i++) {
      const selected = i === state.selected;
      hit(body.length, 0, w, `row:${i}`, undefined, ctx => { state.selected = i; state.detail = !state.detail; return ctx.dialog(); });
      const line = (selected ? p("accent", glyphs.selected) : " ") + tableRow(agg.breakdown[i], selected, agg, w - 1, theme, state.tab);
      add(selected && theme && !noColor() ? styleBgToken(theme, "selectedBg", line) : line);
      if (selected) for (const line of detailLines) add(line);
    }
    if (!agg.breakdown.length) add(p("muted", "No usage in this period."));
  }
  while (body.length < footerRow) add();
  body.splice(footerRow);
  let footer = "";
  for (const [key, label] of footerPairs) {
    const part = `${key} ${label}`;
    const closeWidth = visibleWidth("esc close  ");
    if (key !== "esc" && visibleWidth(footer) + visibleWidth(part) + 2 + closeWidth > w) continue;
    const x = visibleWidth(footer);
    if (key === "c t l") for (const [i, tabKey] of ["c", "t", "l"].entries()) hit(footerRow, x + i * 2, 2, `footer:${tabKey}`, tabKey);
    else if (key === `${glyphs.up} ${glyphs.down}` || key === `${glyphs.left} ${glyphs.right}`) {
      hit(footerRow, x, 2, `footer:${key}:previous`, key.startsWith(glyphs.up) ? "\x1b[A" : "\x1b[D");
      hit(footerRow, x + 2, part.length - 2, `footer:${key}:next`, key.startsWith(glyphs.up) ? "\x1b[B" : "\x1b[C");
    } else hit(footerRow, x, part.length, `footer:${key}`, key === "esc" ? "\x1b" : key === glyphs.enter ? "\r" : key === "1-5" ? "]" : key);
    footer += `${p("accent", key)} ${p("muted", label)}  `;
  }
  add(footer);
  const lines = inset ? [p("border", glyphs.topLeft + glyphs.horizontal.repeat(w) + glyphs.topRight), ...body.map(line => p("border", glyphs.vertical) + pad(line, w) + p("border", glyphs.vertical)), p("border", glyphs.bottomLeft + glyphs.horizontal.repeat(w) + glyphs.bottomRight)] : body.map(line => pad(line, w));
  return { state, lines: lines.slice(0, height), hits: hits.filter(h => h.row < height - inset && (h.row < footerRow + inset || h.id.startsWith("footer:"))) };
}
function renderChart(agg: UsageAggregation, row: UsageBreakdownRow | undefined, state: UsageViewState, width: number, height: number, theme: SessionsTheme | undefined, add: (line: string) => void, hit: (row: number, x: number, width: number, id: string, key?: string, select?: DialogHit["select"]) => void, startRow: number): void {
  let axisWidth = 8;
  let plotWidth = Math.max(1, width - axisWidth);
  const split = agg.buckets.map((b, i) => ({ ...b, values: { selected: Math.min(b.total, row?.buckets[i] ?? 0) } }));
  let buckets = mergeUsageBuckets(split, plotWidth);
  let max = Math.max(1e-9, ...buckets.map(b => b.total));
  const maxLabel = () => state.tab === "cost" ? approx(max) : usageTokens(max);
  while (axisWidth < Math.min(width - 3, visibleWidth(maxLabel()) + 1)) {
    axisWidth = Math.min(width - 3, visibleWidth(maxLabel()) + 1);
    plotWidth = Math.max(1, width - axisWidth);
    buckets = mergeUsageBuckets(split, plotWidth);
    max = Math.max(1e-9, ...buckets.map(b => b.total));
  }
  const per = Math.max(1, Math.floor(plotWidth / Math.max(1, buckets.length))), barWidth = per >= 3 ? per - 1 : 1, gap = per - barWidth;
  if (state.cursor < 0) state.cursor = buckets.length - 1;
  state.cursor = Math.max(0, Math.min(state.cursor, buckets.length - 1));
  const cells = buckets.map(b => stackUsageCells([b.values.selected ?? 0, b.total - (b.values.selected ?? 0)], Math.round(b.total / max * height)));
  for (let y = height; y >= 1; y--) {
    let line = paint(theme, "muted", right(y === height ? fit(maxLabel(), axisWidth - 1) : "", axisWidth - 1)) + paint(theme, "dim", glyphs.vertical);
    for (let i = 0; i < buckets.length; i++) {
      const [highlighted, rest] = cells[i]!;
      const tiny = y === 1 && buckets[i]!.total > 0 && !highlighted && !rest;
      line += y <= highlighted! ? paint(theme, "accent", highlightGlyph().repeat(barWidth))
        : y <= highlighted! + rest! ? paint(theme, "muted", restGlyph().repeat(barWidth))
        : tiny ? paint(theme, buckets[i]!.values.selected ? "accent" : "muted", glyphs.tinyBar.repeat(barWidth)) : " ".repeat(barWidth);
      line += " ".repeat(gap);
      hit(startRow + height - y, axisWidth + i * per, per, `bucket:${i}`, undefined, ctx => { state.cursor = i; return ctx.dialog(); });
    }
    add(line);
  }
  let axis = paint(theme, "muted", right(state.tab === "cost" ? "$0" : "0", axisWidth - 1)) + paint(theme, "dim", glyphs.vertical);
  // The caret sits under the middle cell of its bar, not the slot's first cell.
  const caretAt = Math.floor((barWidth - 1) / 2);
  for (let i = 0; i < buckets.length; i++) {
    axis += i === state.cursor
      ? paint(theme, "dim", glyphs.horizontal.repeat(caretAt)) + paint(theme, "accent", glyphs.chartCursor) + paint(theme, "dim", glyphs.horizontal.repeat(Math.max(0, per - caretAt - 1)))
      : paint(theme, "dim", glyphs.horizontal.repeat(per));
  }
  add(axis);
  let dates = " ".repeat(axisWidth), lastEnd = 0;
  const count = Math.min(4, buckets.length);
  for (let n = 0; n < count; n++) {
    const index = Math.round(n * (buckets.length - 1) / Math.max(1, count - 1)), label = chartDate(buckets[index]!.key, state.period === "24h"), x = Math.min(plotWidth - label.length, index * per);
    if (x >= lastEnd) { dates += " ".repeat(x - lastEnd) + label; lastEnd = x + label.length; }
  }
  if (height > 3) add(paint(theme, "muted", dates));
  const bucket = buckets[state.cursor];
  if (bucket) {
    const value = (n: number) => state.tab === "cost" ? approx(n) : usageTokens(n);
    const selected = bucket.values.selected ?? 0;
    let readout = `${chartDate(bucket.key, state.period === "24h")}${bucket.endKey ? `-${chartDate(bucket.endKey, state.period === "24h")}` : ""}  ${paint(theme, "muted", "total")} ${value(bucket.total)}`;
    const provider = state.breakdown === "models" && row?.providers.length ? ` ${glyphs.pendingStep} ${providerNames(row, agg)}` : "";
    if (row) readout += paint(theme, "accent", `   ${highlightGlyph()} ${row.name}${provider} ${value(selected)}`) + paint(theme, "muted", ` (${bucket.total ? Math.round(selected / bucket.total * 100) : 0}%)`);
    add(fit(readout, width));
  } else add(paint(theme, "muted", "No chart data."));
}
const providerNames = (row: UsageBreakdownRow, agg: UsageAggregation) => row.providers.map(id => agg.providerLabels.get(id) ?? id).join(", ");
function tableRow(row: UsageBreakdownRow | undefined, selected: boolean, agg: UsageAggregation, width: number, theme: SessionsTheme | undefined, metric: "cost" | "tokens"): string {
  const p = (s: string) => paint(theme, selected ? "accent" : "muted", s);
  const shareGlyph = selected ? highlightGlyph() : restGlyph();
  const metricValue = row ? metric === "cost" ? row.unpriced ? "unpriced" : approx(row.estimated) : usageTokens(row.tokens) : metric === "cost" ? "Est. cost" : "Tokens";
  if (width < 48) return pad(row?.name ?? "Name", Math.max(4, width - 14)) + right(metricValue, 14);
  const provider = width >= 110, cache = width >= 130, effective = width >= 150, tokens = metric === "cost" && width >= 70;
  const barWidth = Math.min(20, Math.max(3, Math.floor(width / 7)));
  const reserved = 15 + 6 + barWidth + (provider ? 16 : 0) + (tokens ? 12 : 0) + (cache ? 10 : 0) + (effective ? 12 : 0);
  const nameWidth = Math.max(8, width - reserved);
  const share = row && agg.total.value ? row.value / agg.total.value : 0;
  return pad(row?.name ?? "Name", nameWidth)
    + (provider ? " " + pad(row ? providerNames(row, agg) : "Provider", 15) : "")
    + right(metricValue, 15) + right(row ? `${Math.round(share * 100)}%` : "Share", 6)
    + " " + (row ? p(shareGlyph.repeat(Math.min(barWidth - 1, Math.round(share * (barWidth - 1))))) + " ".repeat(Math.max(0, barWidth - 1 - Math.round(share * (barWidth - 1)))) : pad("", barWidth - 1))
    + (tokens ? right(row ? usageTokens(row.tokens) : "Tokens", 12) : "")
    + (cache ? right(row ? `${Math.round(row.cacheHit * 100)}%` : "Cache", 10) : "")
    + (effective ? right(row ? row.unpriced ? "unpriced" : approx(row.tokens ? row.estimated / row.tokens * 1e6 : 0) : "$/M", 12) : "");
}
function rowDetails(row: UsageBreakdownRow, kind: UsageBreakdown, width: number, theme?: SessionsTheme): string[] {
  const max = Math.max(1, ...row.buckets);
  const spark = row.buckets.slice(-Math.max(1, width - 4)).map(v => glyphs.heatmap[v ? Math.max(1, Math.ceil(v / max * 4)) : 0]).join("");
  return [paint(theme, "muted", `  ${spark}`), paint(theme, "muted", kind === "projects" ? `  ${usageTokens(row.tokens)} tokens  ${approx(row.estimated)} cost  ${row.sessions} sessions` : `  In ${usageTokens(row.input)}  Out ${usageTokens(row.output)}  Read ${usageTokens(row.cacheRead)}  Write ${usageTokens(row.cacheWrite)}`), ...(kind !== "projects" ? [paint(theme, "muted", `  ${Math.round(row.cacheHit * 100)}% cache hit  ${row.unpriced ? "unpriced" : `${approx(row.tokens ? row.estimated / row.tokens * 1e6 : 0)}/M tokens`}`)] : [])];
}
function renderLimits(accounts: UsageAccount[], width: number, now: number, theme?: SessionsTheme): string[] {
  const lines: string[] = [];
  const labelWidth = width >= 78 ? Math.min(22, Math.max(14, Math.floor(width / 6))) : 0;
  let provider: string | undefined;
  for (const account of accounts) {
    if (provider && provider !== account.provider) lines.push("");
    provider = account.provider;
    const stale = accountStale(account, now), age = account.fetchedAt ? ageLabel(Math.max(0, now - account.fetchedAt), "now") : undefined;
    const metadata = [account.plan, account.resetCredits ? `${account.resetCredits} resets` : undefined, stale ? age ? `${age} old` : "no reading" : undefined].filter(Boolean).join(", ");
    const label = bold(paint(theme, "text", `${stale && account.windows.length ? "~" : ""}${account.label}`));
    if (!labelWidth) { lines.push(label); if (metadata) lines.push(paint(theme, "muted", metadata)); }
    const accountLines: string[] = [];
    for (const window of account.windows) {
      const expired = windowExpired(window, now), pace = !stale && !expired ? usagePace(window, now) : undefined;
      const paceText = pace?.kind === "ahead" ? `fast: runs out ${glyphs.approximate} ${pace.runOutAt ? resetTime(pace.runOutAt, now) : "soon"}` : pace?.kind === "under" ? "room to spare" : pace ? "on pace" : "";
      const relative = window.resetAt ? expired ? "refresh needed" : `resets in ${usageCountdown(window.resetAt - now)}` : "reset unknown";
      const absolute = window.resetAt && !expired ? ` ${resetTime(window.resetAt, now)}` : "";
      const available = width - labelWidth;
      const barWidth = available >= 110 ? 28 : available >= 62 ? 20 : Math.max(5, Math.min(16, available - 32));
      const prefix = pad(window.label, width >= 100 ? 6 : 4) + quotaBar(window, barWidth, now, theme, stale, true);
      const percent = expired ? "?%" : `${Math.round(window.remainingPercent)}%`;
      const candidates = [
        `${prefix}  ${percent} left  ${relative}${paint(theme, "muted", absolute)}  ${paint(theme, pace?.kind === "ahead" ? "warning" : "muted", paceText)}`,
        `${prefix}  ${percent} left  ${relative}  ${paint(theme, pace?.kind === "ahead" ? "warning" : "muted", paceText)}`,
        `${prefix}  ${percent}  ${relative.replace("resets ", "")}  ${paint(theme, pace?.kind === "ahead" ? "warning" : "muted", paceText.replace("runs out", "out"))}`,
        `${prefix}  ${percent}  ${relative}`,
        `${prefix} ${percent}`,
      ];
      accountLines.push(candidates.find(s => visibleWidth(s) <= available) ?? candidates.at(-1)!);
      if (available < 48) accountLines.push(paint(theme, "muted", `${relative}${absolute}`));
    }
    if (account.error) accountLines.push(paint(theme, "warning", `${glyphs.warning} ${account.error}`));
    if (!accountLines.length) accountLines.push(paint(theme, "muted", "No quota windows."));
    if (labelWidth && accountLines.length < 2 && metadata) accountLines.push("");
    for (const [i, line] of accountLines.entries()) lines.push((labelWidth ? pad(i === 0 ? label : i === 1 ? paint(theme, "muted", metadata) : "", labelWidth) : "") + line);
    lines.push("");
  }
  return lines;
}
