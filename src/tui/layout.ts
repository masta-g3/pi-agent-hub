import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { RenderModel, RenderSession, StatusCounts } from "./render-model.js";
import { darkTheme, stripAnsi, stripAnsiExceptItalics, styleToken, type SessionsTheme } from "./theme.js";

export function renderSessions(model: RenderModel, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const width = Math.max(40, model.width);
  if (model.empty) return box(width, emptyLines(width, styles), styles);

  const bodyWidth = width - 2;
  if (model.noMatches) return box(width, [renderTopSummary(model, bodyWidth, styles), ...noMatchLines(width, model.filter ?? "", styles), styles.border("─".repeat(bodyWidth)), model.footer], styles);

  const split = model.showPreview ? Math.max(26, Math.min(40, Math.floor(bodyWidth * 0.38))) : bodyWidth;
  const targetRows = bodyRowsFromHeight(model.height);
  const left = renderSessionList(model, split, styles);
  const right = model.showPreview ? renderDetails(model.selected, bodyWidth - split - 1, model.preview, model.detailsExpanded, targetRows, styles) : [];
  const rows = Math.max(left.length, right.length, targetRows ?? 8);
  const body: string[] = [renderTopSummary(model, bodyWidth, styles)];
  for (let i = 0; i < rows; i += 1) {
    const l = pad(left[i] ?? "", split);
    if (!model.showPreview) body.push(l);
    else body.push(`${l}${styles.border("│")}${pad(right[i] ?? "", bodyWidth - split - 1)}`);
  }
  body.push(styles.border("─".repeat(bodyWidth)));
  body.push(truncate(model.footer, bodyWidth));
  return box(width, body, styles);
}

function bodyRowsFromHeight(height: number | undefined): number | undefined {
  if (!height || height <= 0) return undefined;
  return Math.max(8, height - 5);
}

interface LayoutStyles {
  accent(text: string): string;
  border(text: string): string;
  dim(text: string): string;
  error(text: string): string;
  muted(text: string): string;
  warning(text: string): string;
  status(status: RenderSession["displayStatus"], text: string): string;
}

function createStyles(theme: SessionsTheme): LayoutStyles {
  return {
    accent: (text) => styleToken(theme, "accent", text),
    border: (text) => styleToken(theme, "border", text),
    dim: (text) => styleToken(theme, "dim", text),
    error: (text) => styleToken(theme, "error", text),
    muted: (text) => styleToken(theme, "muted", text),
    warning: (text) => styleToken(theme, "warning", text),
    status: (status, text) => styleToken(theme, status === "error" ? "error" : status === "waiting" ? "warning" : status === "running" ? "success" : "muted", text),
  };
}

function plainStyles(): LayoutStyles {
  return createStyles({ ...darkTheme, accent: "", border: "", dim: "", error: "", muted: "", success: "", warning: "" });
}

function emptyLines(width: number, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.accent("No managed Pi sessions yet."),
    "",
    `${styles.accent("▶")} n  create a session here`,
    `${styles.dim(" ")} ?  show help`,
    `${styles.dim(" ")} q  quit`,
    "",
  ].map((line) => truncate(line, inner));
}

function noMatchLines(width: number, filter: string, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.warning(`No sessions match ${JSON.stringify(filter)}.`),
    "",
    `${styles.warning("▶")} Use the footer controls below.`,
    "",
  ].map((line) => truncate(line, inner));
}

const STATUS_ORDER = [
  ["running", "●"],
  ["waiting", "◐"],
  ["idle", "○"],
  ["error", "×"],
  ["stopped", "-"],
] as const;

function renderTopSummary(model: RenderModel, width: number, styles: LayoutStyles): string {
  const countLabel = model.filter === undefined
    ? `${model.summary.total} ${model.summary.total === 1 ? "session" : "sessions"}`
    : `${model.summary.visibleTotal}/${model.summary.total} sessions`;
  const parts = [styles.accent(countLabel)];
  const counts = formatStatusCounts(model.summary.statusCounts, styles);
  if (counts) parts.push(counts);
  if (model.filter !== undefined) parts.push(styles.dim(`filter: ${model.filter}`));
  return truncate(parts.join(" · "), width);
}

function renderSessionList(model: RenderModel, width: number, styles: LayoutStyles): string[] {
  const lines: string[] = [];
  for (const group of model.groups) {
    lines.push(twoColumn(styles.accent(group.name), formatStatusCounts(group.statusCounts, styles), width));
    for (const session of group.sessions) lines.push(renderSessionRow(session, width, styles));
  }
  return lines;
}

function renderDetails(session: RenderSession | undefined, width: number, preview: string, expanded: boolean, targetRows: number | undefined, styles: LayoutStyles): string[] {
  if (!session) return ["No session selected"];
  const lines = expanded ? expandedDetails(session, width, styles) : compactDetails(session, width, styles);
  lines.push("", styles.border("── preview ────────────────────────────────"));
  const previewBudget = Math.max(4, (targetRows ?? lines.length + 12) - lines.length);
  const previewLines = preview.trimEnd() ? preview.trimEnd().split("\n").slice(-previewBudget).map(stripAnsiExceptItalics) : ["preview empty"];
  lines.push(...previewLines);
  return lines.map((line) => truncate(line, width));
}

function titleStatusRow(session: RenderSession, width: number, styles: LayoutStyles): string {
  const status = styles.status(session.displayStatus, `${session.symbol} ${session.displayStatus}`);
  const statusWidth = displayWidth(status);
  if (statusWidth >= width) return truncate(status, width);
  const title = truncate(styles.accent(session.title), Math.max(0, width - statusWidth - 2));
  const gap = Math.max(1, width - displayWidth(title) - statusWidth);
  return `${title}${" ".repeat(gap)}${status}`;
}

function compactDetails(session: RenderSession, width: number, styles: LayoutStyles): string[] {
  const lines = [titleStatusRow(session, width, styles)];
  if (session.kind === "subagent") {
    lines.push(truncate([`agent ${session.agentName ?? "subagent"}`, session.taskPreview ? `task ${session.taskPreview}` : ""].filter(Boolean).join(" · "), width));
  } else {
    const parts = [truncatePath(session.cwd, Math.max(8, Math.floor(width * 0.6)))];
    if (session.worktreeBranch) parts.push(`wt ${session.worktreeBranch}`);
    if (session.repoCount > 1) parts.push(`${session.repoCount} repos`);
    lines.push(truncate(parts.join(" · "), width));
  }
  const capabilities = compactCapabilities(session, width, styles);
  if (capabilities) lines.push(capabilities);
  if (session.error) lines.push(styles.error(`error     ${session.error}`));
  return lines;
}

function compactCapabilities(session: RenderSession, width: number, styles: LayoutStyles): string | undefined {
  const parts = [];
  if ((session.skillCount ?? 0) > 0) parts.push(`skills ${session.skillCount}`);
  if (session.enabledMcpServers.length) parts.push(`mcp ${session.enabledMcpServers.length}`);
  if (!parts.length) return undefined;
  return twoColumn(styles.muted(parts.join(" · ")), styles.dim("s/m edit"), width);
}

function expandedDetails(session: RenderSession, width: number, styles: LayoutStyles): string[] {
  const lines = [
    titleStatusRow(session, width, styles),
    session.kind === "subagent" ? `agent     ${session.agentName ?? "subagent"}` : undefined,
    session.taskPreview ? `task      ${session.taskPreview}` : undefined,
    `cwd       ${truncatePath(session.cwd, Math.max(0, width - 10))}`,
    `repos     ${session.repoCount}`,
    `group     ${session.group}`,
  ].filter((line): line is string => Boolean(line));
  for (const cwd of session.additionalCwds) lines.push(`extra     ${truncatePath(cwd, Math.max(0, width - 10))}`);
  if (session.worktreeBranch) lines.push(`worktree  ${session.worktreeBranch} → ${session.worktreeBaseBranch ?? "unknown"}`);
  if (session.worktreePath) lines.push(`wt path   ${truncatePath(session.worktreePath, Math.max(0, width - 10))}`);
  if (session.workspaceCwd) lines.push(`runtime   ${truncatePath(session.workspaceCwd, Math.max(0, width - 10))}`);
  if (session.sessionFile) lines.push(`session   ${truncatePath(session.sessionFile, Math.max(0, width - 10))}`);
  if (session.enabledMcpServers.length) lines.push(`mcp       ${session.enabledMcpServers.join(", ")}`);
  if (session.resultSummary) lines.push(`result    ${session.resultSummary}`);
  if (session.error) lines.push(styles.error(`error     ${session.error}`));
  return lines;
}

function formatStatusCounts(counts: StatusCounts, styles: LayoutStyles): string {
  return STATUS_ORDER
    .flatMap(([status, symbol]) => counts[status] ? [styles.status(status, `${symbol}${counts[status]}`)] : [])
    .join(" ");
}

function truncatePath(path: string, width: number): string {
  return truncateValue(path, width, "start");
}

function renderSessionRow(session: RenderSession, width: number, styles: LayoutStyles): string {
  const prefix = session.selected ? styles.accent("▶") : session.status === "stopped" ? styles.dim("·") : " ";
  const symbol = styles.status(session.displayStatus, session.symbol);
  const titleText = session.kind === "subagent" ? (session.agentName ?? "subagent") : session.title;
  const title = session.status === "stopped" ? styles.dim(titleText) : titleText;
  const repoBadge = session.repoCount > 1 && session.kind !== "subagent" ? styles.dim(` [${session.repoCount} repos]`) : "";
  const worktreeBadge = session.worktreeBranch && session.kind !== "subagent" ? styles.dim(" [wt]") : "";
  const indent = session.depth > 0 ? styles.dim("  ↳ ") : "";
  return truncate(`${prefix} ${indent}${symbol} ${title}${repoBadge}${worktreeBadge}`, width);
}

export interface FormField {
  key: string;
  label: string;
  value: string;
  cursor?: number;
  hint?: string;
  error?: string;
  section?: string;
  truncate?: "end" | "start";
  readonly?: boolean;
}

export interface FormSpec {
  title: string;
  fields: FormField[];
  focus: string;
  footer: string;
  narrowFooter?: string;
}

export function renderForm(spec: FormSpec, width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const showHints = inner >= 38;
  const labelWidth = Math.max(...spec.fields.map((field) => displayWidth(field.label)), 5);
  const valueWidth = inner - labelWidth - 4;
  const body: string[] = [styles.accent(spec.title), styles.border("─".repeat(inner)), ""];
  let previousSection: string | undefined;
  for (const field of spec.fields) {
    if (field.section && field.section !== previousSection) {
      body.push(styles.muted(field.section));
      previousSection = field.section;
    }
    const focused = field.key === spec.focus && !field.readonly;
    const caret = focused ? styles.accent("▎") : " ";
    const label = focused ? field.label : styles.muted(field.label);
    const rawValue = focused ? styles.accent(renderCursorValue(field.value, field.cursor, valueWidth, field.truncate)) : truncateValue(field.value, valueWidth, field.truncate);
    const value = field.readonly && !focused ? styles.dim(rawValue) : rawValue;
    body.push(`${caret} ${pad(label, labelWidth)}  ${value}`);
    const hintText = field.error ? styles.error(field.error) : (showHints && field.hint ? styles.dim(field.hint) : "");
    if (hintText) body.push(`  ${pad("", labelWidth)}  ${truncate(hintText, valueWidth)}`);
    body.push("");
  }
  body.push(styles.border("─".repeat(inner)));
  const footer = inner < 32 ? (spec.narrowFooter ?? "enter · esc") : spec.footer;
  body.push(truncate(styles.dim(footer), inner));
  return [
    `${styles.border("┌")}${styles.border("─".repeat(inner))}${styles.border("┐")}`,
    ...body.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`),
    `${styles.border("└")}${styles.border("─".repeat(inner))}${styles.border("┘")}`,
  ];
}

function renderCursorValue(value: string, cursor: number | undefined, width: number, mode: "end" | "start" | undefined): string {
  if (width <= 0) return "";
  const chars = [...value];
  const pos = Math.max(0, Math.min(cursor ?? chars.length, chars.length));
  const rendered = `${chars.slice(0, pos).join("")}█${chars.slice(pos).join("")}`;
  if ([...rendered].length <= width) return rendered;
  if (mode === "start" || pos >= width - 1) {
    const tailWidth = Math.max(0, width - 1);
    const tail = `${chars.slice(Math.max(0, pos - tailWidth + 1), pos).join("")}█${chars.slice(pos, pos + Math.max(0, tailWidth - Math.min(pos, tailWidth - 1))).join("")}`;
    return `…${[...tail].slice(-tailWidth).join("")}`;
  }
  return truncate(rendered, width);
}

function truncateValue(value: string, width: number, mode: "end" | "start" | undefined): string {
  if (width <= 0) return "";
  if (displayWidth(value) <= width) return value;
  if (mode !== "start") return truncate(value, width);
  if (width <= 1) return "";
  const visible = stripAnsi(value);
  const tail = [...visible].slice(-(width - 1)).join("");
  return `…${tail}`;
}

export function renderDialog(title: string, rows: string[], width: number, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const body = [styles.accent(title), styles.border("─".repeat(Math.min(inner, Math.max(0, displayWidth(title) + 8)))), ...rows];
  return [
    `${styles.border("┌")}${styles.border("─".repeat(inner))}${styles.border("┐")}`,
    ...body.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`),
    `${styles.border("└")}${styles.border("─".repeat(inner))}${styles.border("┘")}`,
  ];
}

function box(width: number, body: string[], styles: LayoutStyles): string[] {
  const inner = width - 2;
  const title = "pi agent hub";
  const top = `${styles.border("┌")} ${styles.accent(title)} ${styles.border("─".repeat(Math.max(0, inner - displayWidth(title) - 2)))}${styles.border("┐")}`;
  const bottom = `${styles.border("└")}${styles.border("─".repeat(inner))}${styles.border("┘")}`;
  return [top, ...body.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`), bottom].map((line) => truncate(line, width));
}

function twoColumn(left: string, right: string, width: number): string {
  if (!right) return truncate(left, width);
  const rightWidth = displayWidth(right);
  if (rightWidth >= width) return truncate(right, width);
  const visibleLeft = truncate(left, Math.max(0, width - rightWidth - 1));
  const gap = Math.max(1, width - displayWidth(visibleLeft) - rightWidth);
  return `${visibleLeft}${" ".repeat(gap)}${right}`;
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

export function truncate(value: string, width: number): string {
  if (width <= 1) return "";
  return truncateToWidth(value, width, "…");
}

function displayWidth(value: string): number {
  return visibleWidth(value);
}
