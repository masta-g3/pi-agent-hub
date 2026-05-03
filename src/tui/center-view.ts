import { Key, matchesKey, type Component } from "@mariozechner/pi-tui";
import { attachPlan, restartConfirmMessage } from "../app/actions.js";
import type { CenterController } from "../app/controller.js";
import { buildRenderModel } from "./render-model.js";
import { renderCenter, renderDialog } from "./layout.js";
import { stripAnsi, styleToken, type CenterTheme } from "./theme.js";
import { movePickerSelection, renderTwoColumnPicker, togglePickerItem, type PickerState, type PickerItem } from "./two-column-picker.js";

export interface SessionDialogInput {
  title: string;
  cwd?: string;
  group: string;
}

export interface CenterViewActions {
  attachOutsideTmux?: (tmuxSession: string) => void;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  restart?: (sessionId: string) => void;
  createSession?: (input: Required<SessionDialogInput>) => void;
  forkSession?: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => void;
  skills?: () => PickerItem[];
  applySkills?: (items: PickerItem[]) => void | Promise<void>;
  mcpServers?: () => PickerItem[];
  applyMcpServers?: (items: PickerItem[]) => void | Promise<void>;
  copy?: (text: string) => void;
  now?: () => number;
}

export class CenterView implements Component {
  private mode: "normal" | "filter" | "help" | "new" | "fork" | "skills" | "mcp" = "normal";
  private filterDraft = "";
  private dialogDraft = "";
  private picker: PickerState | undefined;
  private message: string | undefined;
  private pendingRestart: { sessionId: string; expiresAt: number } | undefined;

  constructor(private controller: CenterController, private stop: () => void, private actions: CenterViewActions = {}, private theme?: CenterTheme) {}

  handleInput(data: string): void {
    if (this.mode === "filter") {
      this.handleFilterInput(data);
      return;
    }

    if (this.mode === "new" || this.mode === "fork") {
      this.handleDialogInput(data);
      return;
    }

    if (this.mode === "skills" || this.mode === "mcp") {
      this.handlePickerInput(data);
      return;
    }

    if (this.mode === "help") {
      if (data === "q") this.stop();
      else if (matchesKey(data, Key.escape) || data === "?") this.mode = "normal";
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.clearPendingRestart();
      this.message = undefined;
      if (this.controller.snapshot().filter !== undefined) this.controller.setFilter(undefined);
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      this.clearPendingRestart();
      this.controller.move(1);
    }
    else if (matchesKey(data, Key.up) || data === "k") {
      this.clearPendingRestart();
      this.controller.move(-1);
    }
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") this.attachSelected();
    else if (matchesKey(data, Key.slash)) this.startFilter();
    else if (data === "n") this.startNewDialog();
    else if (data === "f") this.startForkDialog();
    else if (data === "r") this.restartSelected();
    else if (data === "s") this.startPicker("skills");
    else if (data === "m") this.startPicker("mcp");
    else if (data === "a") {
      this.clearPendingRestart();
      this.controller.acknowledgeSelected();
    }
    else if (data === "?") {
      this.clearPendingRestart();
      this.mode = "help";
    }
    else if (data === "q") this.stop();
  }

  render(width: number): string[] {
    this.clearExpiredConfirmation();
    if (this.mode === "help") return renderHelp(width);
    if ((this.mode === "skills" || this.mode === "mcp") && this.picker) return renderTwoColumnPicker(this.picker, width, this.theme);
    if (this.mode === "new" || this.mode === "fork") return this.renderSessionDialog(width);
    if (this.pendingRestart && this.message?.startsWith("press r again")) return this.renderRestartDialog(width);
    const snapshot = this.controller.snapshot();
    const lines = renderCenter(buildRenderModel({
      sessions: snapshot.registry.sessions,
      selectedId: snapshot.selectedId,
      width,
      filter: this.mode === "filter" ? this.filterDraft : snapshot.filter,
      filterEditing: this.mode === "filter",
      preview: snapshot.preview,
    }), this.theme);
    return this.message ? replaceFooter(lines, this.message, this.theme) : lines;
  }

  invalidate(): void {}

  private startFilter() {
    if (this.controller.snapshot().registry.sessions.length === 0) return;
    this.clearPendingRestart();
    this.message = undefined;
    this.mode = "filter";
    this.filterDraft = this.controller.snapshot().filter ?? "";
    this.controller.setFilter(this.filterDraft);
  }

  private startNewDialog() {
    this.clearPendingRestart();
    this.mode = "new";
    this.dialogDraft = `${process.cwd()}|default|`;
    this.message = undefined;
  }

  private startForkDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    this.clearPendingRestart();
    this.mode = "fork";
    this.dialogDraft = `${selected.group}|${selected.title} fork`;
    this.message = undefined;
  }

  private startPicker(mode: "skills" | "mcp") {
    this.clearPendingRestart();
    const items = mode === "skills" ? this.actions.skills?.() : this.actions.mcpServers?.();
    if (!items) {
      this.message = `${mode}: no catalog loaded`;
      return;
    }
    if (!items.length) {
      this.message = `${mode}: nothing available`;
      return;
    }
    this.mode = mode;
    this.picker = { title: mode === "skills" ? "Skills" : "MCP — [project]", items, selected: 0 };
  }

  private attachSelected() {
    this.clearPendingRestart();
    this.message = undefined;
    const selected = this.controller.selected();
    if (!selected) return;
    const plan = attachPlan(selected);
    if (plan.type === "inside-tmux") {
      this.actions.copy?.(plan.command);
      const switchInsideTmux = this.actions.switchInsideTmux;
      if (!switchInsideTmux) {
        this.message = plan.message;
        return;
      }
      this.message = `switching: ${plan.command} · Ctrl+Q returns`;
      try {
        const result = switchInsideTmux(selected.tmuxSession);
        if (isPromise(result)) void result.catch((error: unknown) => { this.message = `switch failed: ${errorMessage(error)}`; });
      } catch (error) {
        this.message = `switch failed: ${errorMessage(error)}`;
      }
      return;
    }
    this.actions.attachOutsideTmux?.(selected.tmuxSession);
  }

  private restartSelected() {
    const selected = this.controller.selected();
    if (!selected) return;
    const now = this.actions.now?.() ?? Date.now();
    if (this.pendingRestart?.sessionId === selected.id && this.pendingRestart.expiresAt > now) {
      this.pendingRestart = undefined;
      this.message = undefined;
      this.actions.restart?.(selected.id);
      return;
    }
    this.pendingRestart = { sessionId: selected.id, expiresAt: now + 2_000 };
    this.message = restartConfirmMessage(selected.title);
  }

  private clearPendingRestart() {
    this.pendingRestart = undefined;
    if (this.message?.startsWith("press r again")) this.message = undefined;
  }

  private clearExpiredConfirmation() {
    if (!this.pendingRestart) return;
    const now = this.actions.now?.() ?? Date.now();
    if (this.pendingRestart.expiresAt <= now) this.clearPendingRestart();
  }

  private handlePickerInput(data: string) {
    if (!this.picker) {
      this.mode = "normal";
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.picker = undefined;
      return;
    }
    if (matchesKey(data, Key.down)) this.picker = movePickerSelection(this.picker, 1);
    else if (matchesKey(data, Key.up)) this.picker = movePickerSelection(this.picker, -1);
    else if (matchesKey(data, Key.space) || data === " ") this.picker = togglePickerItem(this.picker);
    else if (matchesKey(data, Key.backspace)) this.picker = { ...this.picker, filter: (this.picker.filter ?? "").slice(0, -1) };
    else if (isPrintable(data)) this.picker = { ...this.picker, filter: `${this.picker.filter ?? ""}${data}`, selected: 0 };
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      const items = this.picker.items;
      const apply = this.mode === "skills" ? this.actions.applySkills : this.actions.applyMcpServers;
      const success = this.mode === "skills" ? "restart session to reload skills" : "restart session to reload MCP tools";
      this.mode = "normal";
      this.picker = undefined;
      try {
        const result = apply?.(items);
        if (isPromise(result)) void result.then(() => { this.message = success; }).catch((error: unknown) => { this.message = errorMessage(error); });
        else this.message = success;
      } catch (error) {
        this.message = errorMessage(error);
      }
    }
  }

  private handleDialogInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.dialogDraft = "";
      this.message = undefined;
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      if (this.mode === "new") this.submitNewDialog();
      else this.submitForkDialog();
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.message = undefined;
      this.dialogDraft = this.dialogDraft.slice(0, -1);
      return;
    }
    if (isPrintable(data)) {
      this.message = undefined;
      this.dialogDraft += data;
    }
  }

  private submitNewDialog() {
    const [cwd, group, title] = this.dialogDraft.split("|");
    if (!cwd?.trim() || !group?.trim() || !title?.trim()) {
      this.message = "Required: cwd, group, and title";
      return;
    }
    this.actions.createSession?.({ cwd: cwd.trim(), group: group.trim(), title: title.trim() });
    this.mode = "normal";
    this.dialogDraft = "";
  }

  private submitForkDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    const [group, title] = this.dialogDraft.split("|");
    if (!group?.trim() || !title?.trim()) {
      this.message = "Required: group and title";
      return;
    }
    this.actions.forkSession?.(selected.id, { group: group.trim(), title: title.trim() });
    this.mode = "normal";
    this.dialogDraft = "";
  }

  private renderRestartDialog(width: number): string[] {
    const selected = this.controller.selected();
    return renderDialog("Restart session", [
      selected ? `target  ${selected.title}` : "target  none",
      "",
      this.message ?? "press r again to confirm",
      "esc cancel",
    ], width, this.theme);
  }

  private renderSessionDialog(width: number): string[] {
    if (this.mode === "new") {
      const [cwd = "", group = "", title = ""] = this.dialogDraft.split("|");
      return renderDialog("New session", [
        "Type: cwd|group|title, then enter",
        "",
        `cwd    ${cwd}`,
        `group  ${group}`,
        `title  ${title}`,
        "",
        this.message ?? "esc cancel",
      ], width, this.theme);
    }
    const [group = "", title = ""] = this.dialogDraft.split("|");
    return renderDialog("Fork session", [
      "Type: group|title, then enter",
      "",
      `group  ${group}`,
      `title  ${title}`,
      "",
      this.message ?? "esc cancel",
    ], width, this.theme);
  }

  private handleFilterInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.filterDraft = "";
      this.controller.setFilter(undefined);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      this.mode = "normal";
      this.controller.setFilter(this.filterDraft);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.filterDraft = this.filterDraft.slice(0, -1);
      this.controller.setFilter(this.filterDraft);
      return;
    }
    if (isPrintable(data)) {
      this.filterDraft += data;
      this.controller.setFilter(this.filterDraft);
    }
  }
}

function isPrintable(data: string): boolean {
  return [...data].length === 1 && data >= " " && data !== "\u007f";
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderHelp(width: number): string[] {
  const lines = [
    "pi center help",
    "",
    "navigation   ↑↓/j/k move   / filter",
    "sessions     enter attach   n new   f fork   r restart   a mark read",
    "config       s skills       m mcp",
    "system       q quit         esc cancel",
  ];
  const inner = Math.max(40, width) - 2;
  return [
    `┌${"─".repeat(inner)}┐`,
    ...lines.map((line) => `│${line.padEnd(inner).slice(0, inner)}│`),
    `└${"─".repeat(inner)}┘`,
  ];
}

function replaceFooter(lines: string[], message: string, theme?: CenterTheme): string[] {
  if (lines.length < 3) return lines;
  const copy = lines.slice();
  const footerIndex = copy.length - 2;
  const width = stripAnsi(copy[footerIndex] ?? "").length;
  const inner = Math.max(0, width - 2);
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  const text = truncateVisible(message, inner);
  copy[footerIndex] = `${border("│")}${text}${" ".repeat(Math.max(0, inner - stripAnsi(text).length))}${border("│")}`;
  return copy;
}

function truncateVisible(value: string, width: number): string {
  if (stripAnsi(value).length <= width) return value;
  if (width <= 1) return "";
  return `${[...stripAnsi(value)].slice(0, width - 1).join("")}…`;
}
