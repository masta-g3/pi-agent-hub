import type { RenderModel, RenderSession } from "./render-model.js";
import { darkTheme, stripAnsi, styleToken, type SessionsTheme } from "./theme.js";

export function renderSessions(model: RenderModel, theme?: SessionsTheme): string[] {
  const styles = theme ? createStyles(theme) : plainStyles();
  const width = Math.max(40, model.width);
  if (model.empty) return box(width, emptyLines(width, styles), styles);
  if (model.noMatches) return box(width, [...noMatchLines(width, model.filter ?? "", styles), styles.border("─".repeat(width - 2)), model.footer], styles);

  const bodyWidth = width - 2;
  const split = model.showPreview ? Math.max(26, Math.min(40, Math.floor(bodyWidth * 0.38))) : bodyWidth;
  const left = renderSessionList(model, split, styles);
  const right = model.showPreview ? renderDetails(model.selected, bodyWidth - split - 1, model.preview, styles) : [];
  const rows = Math.max(left.length, right.length, 8);
  const body: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const l = pad(left[i] ?? "", split);
    if (!model.showPreview) body.push(l);
    else body.push(`${l}${styles.border("│")}${pad(right[i] ?? "", bodyWidth - split - 1)}`);
  }
  body.push(styles.border("─".repeat(bodyWidth)));
  body.push(truncate(model.footer, bodyWidth));
  return box(width, body, styles);
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
    "n  create a session here",
    "?  show help",
    "q  quit",
    "",
  ].map((line) => truncate(line, inner));
}

function noMatchLines(width: number, filter: string, styles: LayoutStyles): string[] {
  const inner = width - 2;
  return [
    "",
    styles.warning(`No sessions match ${JSON.stringify(filter)}.`),
    "",
    "Use the footer controls below.",
    "",
  ].map((line) => truncate(line, inner));
}

function renderSessionList(model: RenderModel, width: number, styles: LayoutStyles): string[] {
  const lines: string[] = [];
  for (const group of model.groups) {
    const counts = [group.waitingCount ? `${group.waitingCount} waiting` : "", group.errorCount ? `${group.errorCount} error` : ""].filter(Boolean).join(" · ");
    lines.push(twoColumn(styles.accent(group.name), counts ? styles.warning(counts) : "", width));
    for (const session of group.live) lines.push(renderSessionRow(session, width, styles));
    if (group.stopped.length) {
      lines.push(truncate(styles.dim("  Stopped"), width));
      for (const session of group.stopped) lines.push(renderSessionRow(session, width, styles));
    }
  }
  return lines;
}

function renderDetails(session: RenderSession | undefined, width: number, preview: string, styles: LayoutStyles): string[] {
  if (!session) return ["No session selected"];
  const lines = [
    twoColumn(styles.accent(session.title), styles.status(session.displayStatus, `${session.displayStatus} ${session.symbol}`), width),
    `cwd       ${session.cwd}`,
    `group     ${session.group}`,
  ];
  if (session.sessionFile) lines.push(`session   ${session.sessionFile}`);
  if (session.enabledMcpServers.length) lines.push(`mcp       ${session.enabledMcpServers.join(", ")}`);
  if (session.error) lines.push(styles.error(`error     ${session.error}`));
  lines.push("", styles.border("── preview (read-only) ───────────────────────"));
  const previewLines = preview.trimEnd() ? preview.trimEnd().split("\n").slice(-12) : ["preview empty"];
  lines.push(...previewLines);
  return lines.map((line) => truncate(line, width));
}

function renderSessionRow(session: RenderSession, width: number, styles: LayoutStyles): string {
  const prefix = session.selected ? styles.accent("▶") : session.status === "stopped" ? styles.dim("·") : " ";
  const symbol = styles.status(session.displayStatus, session.symbol);
  const title = session.status === "stopped" ? styles.dim(session.title) : session.title;
  return truncate(`${prefix} ${symbol} ${title}`, width);
}

export interface FormField {
  key: string;
  label: string;
  value: string;
  hint?: string;
  error?: string;
  truncate?: "end" | "start";
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
  for (const field of spec.fields) {
    const focused = field.key === spec.focus;
    const caret = focused ? styles.accent("▎") : " ";
    const label = focused ? field.label : styles.muted(field.label);
    const truncated = truncateValue(field.value, valueWidth - (focused ? 1 : 0), field.truncate);
    const cursor = focused ? styles.accent("█") : "";
    const value = focused ? `${styles.accent(truncated)}${cursor}` : truncated;
    body.push(`${caret} ${pad(label, labelWidth)}  ${value}`);
    if (showHints || field.error) {
      const hintText = field.error ? styles.error(field.error) : (field.hint ? styles.dim(field.hint) : "");
      body.push(hintText ? `  ${pad("", labelWidth)}  ${truncate(hintText, valueWidth)}` : "");
    }
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
  const top = `${styles.border("┌")} ${styles.accent("pi sessions")} ${styles.border("─".repeat(Math.max(0, inner - 11)))}${styles.border("┐")}`;
  const bottom = `${styles.border("└")}${styles.border("─".repeat(inner))}${styles.border("┘")}`;
  return [top, ...body.map((line) => `${styles.border("│")}${pad(line, inner)}${styles.border("│")}`), bottom].map((line) => truncate(line, width));
}

function twoColumn(left: string, right: string, width: number): string {
  if (!right) return truncate(left, width);
  const gap = width - displayWidth(left) - displayWidth(right);
  if (gap < 1) return truncate(`${left} ${right}`, width);
  return `${left}${" ".repeat(gap)}${right}`;
}

function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

export function truncate(value: string, width: number): string {
  if (displayWidth(value) <= width) return value;
  if (width <= 1) return "";
  let visible = 0;
  let out = "";
  for (let i = 0; i < value.length && visible < width - 1;) {
    if (value[i] === "\u001b") {
      const match = /^\u001b\[[0-9;]*m/.exec(value.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    out += value[i];
    visible += 1;
    i += 1;
  }
  return value.includes("\u001b[") ? `${out}…\u001b[0m` : `${out}…`;
}

function displayWidth(value: string): number {
  return [...stripAnsi(value)].length;
}
