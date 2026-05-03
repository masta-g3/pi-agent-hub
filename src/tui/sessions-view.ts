import { Key, matchesKey, type Component } from "@mariozechner/pi-tui";
import { attachPlan, restartConfirmMessage } from "../app/actions.js";
import type { SessionsController } from "../app/controller.js";
import { buildRenderModel } from "./render-model.js";
import { renderSessions, renderDialog, renderForm } from "./layout.js";
import { stripAnsi, styleToken, type SessionsTheme } from "./theme.js";
import { movePickerSelection, renderTwoColumnPicker, togglePickerItem, type PickerState, type PickerItem } from "./two-column-picker.js";
import { appendChar, backspace, createNewForm, cycleCwdSuggestion, moveFocus, submission, validateNewForm, type NewFormContext, type NewFormState } from "./new-form.js";

export interface SessionDialogInput {
  title: string;
  cwd?: string;
  group: string;
}

export interface SessionsViewActions {
  attachOutsideTmux?: (tmuxSession: string) => void;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  restart?: (sessionId: string) => void;
  deleteSession?: (sessionId: string) => void | Promise<void>;
  createSession?: (input: Required<SessionDialogInput>) => void;
  forkSession?: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => void;
  newFormContext?: () => NewFormContext;
  skills?: () => PickerItem[];
  applySkills?: (items: PickerItem[]) => void | Promise<void>;
  mcpServers?: () => PickerItem[];
  applyMcpServers?: (items: PickerItem[]) => void | Promise<void>;
  copy?: (text: string) => void;
  now?: () => number;
}

export class SessionsView implements Component {
  private mode: "normal" | "filter" | "help" | "new" | "fork" | "skills" | "mcp" | "delete" = "normal";
  private filterDraft = "";
  private dialogDraft = "";
  private newForm: NewFormState | undefined;
  private picker: PickerState | undefined;
  private message: string | undefined;
  private pendingRestart: { sessionId: string; expiresAt: number } | undefined;
  private deleteTargetId: string | undefined;
  private deleting = false;

  constructor(private controller: SessionsController, private stop: () => void, private actions: SessionsViewActions = {}, private theme?: SessionsTheme) {}

  handleInput(data: string): void {
    if (this.mode === "filter") {
      this.handleFilterInput(data);
      return;
    }

    if (this.mode === "new") {
      this.handleNewFormInput(data);
      return;
    }

    if (this.mode === "fork") {
      this.handleDialogInput(data);
      return;
    }

    if (this.mode === "skills" || this.mode === "mcp") {
      this.handlePickerInput(data);
      return;
    }

    if (this.mode === "delete") {
      this.handleDeleteInput(data);
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
    else if (data === "d") this.startDeleteDialog();
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
    if (this.mode === "new" && this.newForm) return this.renderNewForm(width);
    if (this.mode === "fork") return this.renderSessionDialog(width);
    if (this.mode === "delete") return this.renderDeleteDialog(width);
    if (this.pendingRestart && this.message?.startsWith("press r again")) return this.renderRestartDialog(width);
    const snapshot = this.controller.snapshot();
    const lines = renderSessions(buildRenderModel({
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
    const ctx = this.actions.newFormContext?.() ?? { cwd: process.cwd() };
    this.mode = "new";
    this.newForm = createNewForm(ctx);
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

  private startDeleteDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    this.clearPendingRestart();
    this.mode = "delete";
    this.deleteTargetId = selected.id;
    this.message = undefined;
  }

  private handleDeleteInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.deleting) return;
      this.mode = "normal";
      this.deleteTargetId = undefined;
      this.message = undefined;
      return;
    }
    if (data !== "d" || this.deleting) return;
    const id = this.deleteTargetId;
    if (!id) {
      this.mode = "normal";
      return;
    }
    try {
      this.deleting = true;
      const result = this.actions.deleteSession?.(id);
      if (isPromise(result)) {
        void result.then(() => {
          this.deleting = false;
          this.mode = "normal";
          this.deleteTargetId = undefined;
          this.message = "session deleted";
        }).catch((error: unknown) => {
          this.deleting = false;
          this.message = errorMessage(error);
        });
      } else {
        this.deleting = false;
        this.mode = "normal";
        this.deleteTargetId = undefined;
        this.message = "session deleted";
      }
    } catch (error) {
      this.deleting = false;
      this.message = errorMessage(error);
    }
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
      this.submitForkDialog();
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

  private handleNewFormInput(data: string) {
    if (!this.newForm) {
      this.mode = "normal";
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.newForm = undefined;
      this.message = undefined;
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      const result = validateNewForm(this.newForm);
      this.newForm = result.state;
      if (!result.ok) return;
      this.actions.createSession?.(submission(result.state));
      this.mode = "normal";
      this.newForm = undefined;
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) {
      this.newForm = moveFocus(this.newForm, 1);
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) {
      this.newForm = moveFocus(this.newForm, -1);
      return;
    }
    if (matchesKey(data, Key.ctrl("n"))) {
      this.newForm = cycleCwdSuggestion(this.newForm, 1);
      return;
    }
    if (matchesKey(data, Key.ctrl("p"))) {
      this.newForm = cycleCwdSuggestion(this.newForm, -1);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.newForm = backspace(this.newForm);
      return;
    }
    if (isPrintable(data)) this.newForm = appendChar(this.newForm, data);
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

  private renderDeleteDialog(width: number): string[] {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.deleteTargetId);
    return renderDialog("Delete session", [
      target ? `target  ${target.title}` : "target  none",
      "",
      "Removes this session from pi-sessions.",
      "Pi conversation files are kept.",
      "",
      this.deleting ? "deleting..." : this.message ?? "press d again to delete · esc cancel",
    ], width, this.theme);
  }

  private renderNewForm(width: number): string[] {
    if (!this.newForm) return [];
    return renderForm({
      title: "New session",
      fields: this.newForm.order.map((key) => this.newForm!.fields[key]),
      focus: this.newForm.focus,
      footer: newFormFooter(this.newForm),
      narrowFooter: "tab · enter · esc",
    }, width, this.theme);
  }

  private renderSessionDialog(width: number): string[] {
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

function newFormFooter(state: NewFormState): string {
  const focus = state.fields[state.focus];
  const cwdHasSuggestions = state.focus === "cwd" && (focus.suggestions?.length ?? 0) > 1;
  const parts = ["tab/↓ next", "shift-tab/↑ prev"];
  if (cwdHasSuggestions) parts.push("ctrl-n/p cycle");
  parts.push("enter create", "esc cancel");
  return parts.join(" · ");
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderHelp(width: number): string[] {
  const lines = [
    "pi sessions help",
    "",
    "navigation   ↑↓/j/k move   / filter",
    "sessions     enter attach   n new   f fork   r restart   d delete   a mark read",
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

function replaceFooter(lines: string[], message: string, theme?: SessionsTheme): string[] {
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
