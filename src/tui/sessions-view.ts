import { Key, matchesKey, type Component } from "@mariozechner/pi-tui";
import { attachPlan, restartConfirmMessage } from "../app/actions.js";
import type { SessionsController } from "../app/controller.js";
import { sessionCascadeIds } from "../core/session-tree.js";
import type { ManagedSession } from "../core/types.js";
import { buildRenderModel } from "./render-model.js";
import { renderSessions, renderDialog, renderForm } from "./layout.js";
import { stripAnsi, styleToken, type SessionsTheme } from "./theme.js";
import { movePickerSelection, renderTwoColumnPicker, togglePickerItem, type PickerState, type PickerItem } from "./two-column-picker.js";
import {
  addRepo,
  appendChar,
  backspace,
  backspaceWord,
  createNewForm,
  cycleCwdSuggestion,
  deleteForward,
  deleteWord,
  moveCursor,
  moveCursorEnd,
  moveCursorHome,
  moveCursorWordLeft,
  moveCursorWordRight,
  moveFocus,
  removeFocusedRepo,
  setRepoValue,
  submission,
  validateNewForm,
  isRepoKey,
  type NewFormContext,
  type NewFormState,
  type RepoFieldKey,
} from "./new-form.js";
import {
  appendChar as appendFormChar,
  backspace as backspaceForm,
  backspaceFieldWord,
  createForm,
  deleteFieldWord,
  deleteForward as deleteFormForward,
  moveFieldCursor,
  moveFieldCursorEnd,
  moveFieldCursorHome,
  moveFieldCursorWordLeft,
  moveFieldCursorWordRight,
  moveFocus as moveFormFocus,
  validateRequired,
  type FormState,
} from "./form.js";
import { createRepoPicker, moveRepoPickerSelection, renderRepoPicker, selectedRepoCwd, type RepoPickerState } from "./repo-picker.js";
import { backspaceText, backspaceWord as backspaceTextWord, createTextInput, deleteText, deleteWord as deleteTextWord, insertText, moveCursor as moveTextCursor, moveCursorEnd as moveTextCursorEnd, moveCursorHome as moveTextCursorHome, moveCursorWordLeft as moveTextCursorWordLeft, moveCursorWordRight as moveTextCursorWordRight, type TextInputState } from "./text-input.js";

export interface SessionDialogInput {
  title: string;
  cwd?: string;
  group: string;
  additionalCwds?: string[];
}

export interface SessionsViewActions {
  attachOutsideTmux?: (tmuxSession: string) => void;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  restart?: (sessionId: string) => unknown;
  deleteSession?: (sessionId: string) => void | Promise<void>;
  closeSubagents?: (sessionId: string) => void | Promise<void>;
  createSession?: (input: SessionDialogInput & { cwd: string }) => unknown;
  forkSession?: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => unknown;
  changeGroup?: (sessionId: string, group: string) => unknown;
  renameSession?: (sessionId: string, title: string) => unknown;
  renameGroup?: (from: string, to: string) => unknown;
  reorderSelected?: (delta: -1 | 1) => unknown;
  acknowledge?: () => unknown;
  newFormContext?: () => NewFormContext;
  skills?: () => PickerItem[] | Promise<PickerItem[]>;
  applySkills?: (items: PickerItem[]) => void | Promise<void>;
  mcpServers?: () => PickerItem[] | Promise<PickerItem[]>;
  applyMcpServers?: (items: PickerItem[]) => void | Promise<void>;
  copy?: (text: string) => void;
  now?: () => number;
}

export class SessionsView implements Component {
  private mode: "normal" | "filter" | "help" | "new" | "repoPicker" | "fork" | "group" | "rename" | "groupRename" | "skills" | "mcp" | "delete" = "normal";
  private filterDraft: TextInputState = createTextInput();
  private newForm: NewFormState | undefined;
  private repoPicker: RepoPickerState | undefined;
  private repoPickerTarget: RepoFieldKey | undefined;
  private forkForm: FormState<"group" | "title"> | undefined;
  private moveGroupForm: FormState<"group"> | undefined;
  private renameSessionForm: FormState<"title"> | undefined;
  private renameGroupForm: FormState<"to"> | undefined;
  private picker: PickerState | undefined;
  private message: string | undefined;
  private pendingRestart: { sessionId: string; expiresAt: number } | undefined;
  private deleteTargetId: string | undefined;
  private renameGroupFrom: string | undefined;
  private returnAfterRenameTmuxSession: string | undefined;
  private busy = false;
  private deleting: false | "session" | "subagents" = false;

  constructor(private controller: SessionsController, private stop: () => void, private actions: SessionsViewActions = {}, private theme?: SessionsTheme) {}

  setTheme(theme: SessionsTheme): void {
    this.theme = theme;
  }

  handleInput(data: string): void {
    if (this.mode === "filter") {
      this.handleFilterInput(data);
      return;
    }

    if (this.mode === "new") {
      this.handleNewFormInput(data);
      return;
    }

    if (this.mode === "repoPicker") {
      this.handleRepoPickerInput(data);
      return;
    }

    if (this.mode === "fork") {
      this.handleFormInput(data, this.forkForm, (state) => { this.forkForm = state; }, () => this.submitForkDialog());
      return;
    }

    if (this.mode === "group") {
      this.handleFormInput(data, this.moveGroupForm, (state) => { this.moveGroupForm = state; }, () => this.submitGroupDialog());
      return;
    }

    if (this.mode === "rename") {
      this.handleFormInput(data, this.renameSessionForm, (state) => { this.renameSessionForm = state; }, () => this.submitRenameSessionDialog());
      return;
    }

    if (this.mode === "groupRename") {
      this.handleFormInput(data, this.renameGroupForm, (state) => { this.renameGroupForm = state; }, () => this.submitRenameGroupDialog());
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

    if (this.busy) {
      if (data === "q") this.stop();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.clearPendingRestart();
      this.message = undefined;
      if (this.controller.snapshot().filter !== undefined) this.controller.setFilter(undefined);
      return;
    }

    if (this.pendingRestart) {
      const now = this.actions.now?.() ?? Date.now();
      if (this.pendingRestart.expiresAt <= now) this.clearPendingRestart();
      else {
        if (data === "R") this.restartSelected();
        return;
      }
    }

    if (data === "J" || matchesKey(data, Key.shift("down"))) this.reorderSelected(1);
    else if (data === "K" || matchesKey(data, Key.shift("up"))) this.reorderSelected(-1);
    else if (matchesKey(data, Key.down) || data === "j") {
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
    else if (data === "g") this.startGroupDialog();
    else if (data === "e" || data === "r") this.startRenameSessionDialog();
    else if (data === "G") this.startRenameGroupDialog();
    else if (data === "R") this.restartSelected();
    else if (data === "d") this.startDeleteDialog();
    else if (data === "s") this.startPicker("skills");
    else if (data === "m") this.startPicker("mcp");
    else if (data === "a") {
      this.clearPendingRestart();
      this.runAction(() => this.actions.acknowledge ? this.actions.acknowledge() : this.controller.acknowledgeSelected(), "marking read...");
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
    if (this.mode === "repoPicker" && this.repoPicker) return renderRepoPicker(this.repoPicker, width, this.theme);
    if (this.mode === "new" && this.newForm) return this.renderNewForm(width);
    if (this.mode === "fork") return this.renderSessionDialog(width);
    if (this.mode === "group") return this.renderGroupDialog(width);
    if (this.mode === "rename") return this.renderRenameSessionDialog(width);
    if (this.mode === "groupRename") return this.renderRenameGroupDialog(width);
    if (this.mode === "delete") return this.renderDeleteDialog(width);
    if (this.pendingRestart && this.message?.startsWith("press R again")) return this.renderRestartDialog(width);
    const snapshot = this.controller.snapshot();
    const lines = renderSessions(buildRenderModel({
      sessions: snapshot.registry.sessions,
      selectedId: snapshot.selectedId,
      width,
      filter: this.mode === "filter" ? this.filterDraft.value : snapshot.filter,
      filterEditing: this.mode === "filter",
      preview: snapshot.preview,
    }), this.theme);
    const withFooter = this.mode === "filter" ? replaceFooter(lines, filterFooter(this.filterDraft, this.theme), this.theme) : lines;
    return this.message ? replaceFooter(withFooter, this.message, this.theme) : withFooter;
  }

  invalidate(): void {}

  openRenameForTmuxSession(tmuxSession: string): boolean {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.tmuxSession === tmuxSession);
    if (!target) {
      this.message = `session not found: ${tmuxSession}`;
      return false;
    }
    this.controller.setFilter(undefined);
    if (!this.controller.selectSession(target.id)) return false;
    this.startRenameSessionDialog(tmuxSession);
    return this.mode === "rename";
  }

  private startFilter() {
    if (this.controller.snapshot().registry.sessions.length === 0) return;
    this.clearPendingRestart();
    this.message = undefined;
    this.mode = "filter";
    this.filterDraft = createTextInput(this.controller.snapshot().filter ?? "");
    this.controller.setFilter(this.filterDraft.value);
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
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be forked";
      return;
    }
    this.clearPendingRestart();
    this.mode = "fork";
    this.forkForm = createForm<"group" | "title">([
      { key: "group", label: "group", value: selected.group, hint: "session group label" },
      { key: "title", label: "title", value: `${selected.title} fork`, hint: "display title for the fork" },
    ]);
    this.message = undefined;
  }

  private startGroupDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows follow their parent group";
      return;
    }
    this.clearPendingRestart();
    this.mode = "group";
    this.moveGroupForm = createForm<"group">([
      { key: "group", label: "group", value: "", hint: "existing or new group label" },
    ]);
    this.message = undefined;
  }

  private startRenameSessionDialog(returnAfterRenameTmuxSession?: string) {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be renamed";
      return;
    }
    this.clearPendingRestart();
    this.returnAfterRenameTmuxSession = returnAfterRenameTmuxSession;
    this.mode = "rename";
    this.renameSessionForm = createForm<"title">([
      { key: "title", label: "title", value: selected.title, hint: "session display title" },
    ]);
    this.message = undefined;
  }

  private startRenameGroupDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot rename groups";
      return;
    }
    this.clearPendingRestart();
    this.mode = "groupRename";
    this.renameGroupFrom = selected.group;
    this.renameGroupForm = createForm<"to">([
      { key: "to", label: "to", value: selected.group, hint: `renames all sessions currently in ${selected.group}` },
    ]);
    this.message = undefined;
  }

  private startPicker(mode: "skills" | "mcp") {
    this.clearPendingRestart();
    const result = mode === "skills" ? this.actions.skills?.() : this.actions.mcpServers?.();
    if (!result) {
      this.message = `${mode}: no catalog loaded`;
      return;
    }
    if (isPromise<PickerItem[]>(result)) {
      this.busy = true;
      this.message = `loading ${mode}...`;
      void result.then((items) => {
        this.busy = false;
        this.openPicker(mode, items);
      }).catch((error: unknown) => {
        this.busy = false;
        this.message = errorMessage(error);
      });
      return;
    }
    this.openPicker(mode, result);
  }

  private openPicker(mode: "skills" | "mcp", items: PickerItem[]) {
    if (!items.length) {
      this.message = `${mode}: nothing available`;
      return;
    }
    this.mode = mode;
    this.picker = { title: mode === "skills" ? "Skills" : "MCP — [project]", items, selected: 0 };
    this.message = undefined;
  }

  private attachSelected() {
    this.clearPendingRestart();
    this.message = undefined;
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.status === "stopped") {
      if (this.actions.restart) this.runAction(() => this.actions.restart?.(selected.id), "starting stopped session...");
      else this.message = "session stopped; press R twice to restart";
      return;
    }
    if (selected.status === "waiting") {
      try {
        const result = this.actions.acknowledge ? this.actions.acknowledge() : this.controller.acknowledgeSelected();
        if (isPromise(result)) {
          this.busy = true;
          this.message = "marking read...";
          void result.then(() => {
            this.busy = false;
            this.attachSession(selected);
          }).catch((error: unknown) => {
            this.busy = false;
            this.message = errorMessage(error);
          });
          return;
        }
      } catch (error) {
        this.message = errorMessage(error);
        return;
      }
    }
    this.attachSession(selected);
  }

  private attachSession(selected: ManagedSession) {
    const plan = attachPlan(selected);
    if (plan.type === "inside-tmux") {
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

  private reorderSelected(delta: -1 | 1) {
    this.clearPendingRestart();
    this.message = undefined;
    if (this.controller.snapshot().filter !== undefined) {
      this.message = "clear filter to reorder";
      return;
    }
    if (this.controller.selected()?.kind === "subagent") {
      this.message = "subagent rows follow their parent order";
      return;
    }
    const reorder = this.actions.reorderSelected;
    this.runAction(() => reorder ? reorder(delta) : this.controller.reorderSelected(delta), "reordering session...");
  }

  private restartSelected() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be restarted here";
      return;
    }
    const now = this.actions.now?.() ?? Date.now();
    if (this.pendingRestart?.sessionId === selected.id && this.pendingRestart.expiresAt > now) {
      this.pendingRestart = undefined;
      this.message = undefined;
      this.runAction(() => this.actions.restart?.(selected.id), "restarting session...");
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
    const closeSubagents = data === "s" && this.subagentTargets(this.deleteTargetId).length > 0;
    if ((data !== "d" && !closeSubagents) || this.deleting) return;
    const id = this.deleteTargetId;
    if (!id) {
      this.mode = "normal";
      return;
    }
    const action = closeSubagents ? this.actions.closeSubagents : this.actions.deleteSession;
    const successMessage = closeSubagents ? "subagents closed" : "session deleted";
    try {
      this.deleting = closeSubagents ? "subagents" : "session";
      const result = action?.(id);
      if (isPromise(result)) {
        void result.then(() => {
          this.deleting = false;
          this.mode = "normal";
          this.deleteTargetId = undefined;
          this.message = successMessage;
        }).catch((error: unknown) => {
          this.deleting = false;
          this.message = errorMessage(error);
        });
      } else {
        this.deleting = false;
        this.mode = "normal";
        this.deleteTargetId = undefined;
        this.message = successMessage;
      }
    } catch (error) {
      this.deleting = false;
      this.message = errorMessage(error);
    }
  }

  private clearPendingRestart() {
    this.pendingRestart = undefined;
    if (this.message?.startsWith("press R again")) this.message = undefined;
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
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") this.applyPickerSelection();
    else {
      const edited = editPickerSearch(data, this.picker);
      if (edited) this.picker = edited;
    }
  }

  private applyPickerSelection() {
    if (!this.picker) return;
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

  private handleFormInput<K extends string>(data: string, state: FormState<K> | undefined, setState: (state: FormState<K> | undefined) => void, submit: () => void) {
    if (!state) {
      this.mode = "normal";
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      setState(undefined);
      this.renameGroupFrom = undefined;
      this.returnAfterRenameTmuxSession = undefined;
      this.message = undefined;
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      submit();
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) {
      setState(moveFormFocus(state, 1));
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) {
      setState(moveFormFocus(state, -1));
      return;
    }
    const edited = editFormState(data, state);
    if (edited) {
      this.message = undefined;
      setState(edited);
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
      this.runAction(() => this.actions.createSession?.(submission(result.state)), "creating session...");
      this.mode = "normal";
      this.newForm = undefined;
      return;
    }
    if (matchesKey(data, Key.alt("a"))) {
      this.newForm = addRepo(this.newForm);
      return;
    }
    if (matchesKey(data, Key.alt("x"))) {
      this.newForm = removeFocusedRepo(this.newForm);
      return;
    }
    if (matchesKey(data, Key.ctrl("o"))) {
      this.startRepoPicker();
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
    const edited = editNewFormState(data, this.newForm);
    if (edited) this.newForm = edited;
  }

  private startRepoPicker() {
    if (!this.newForm || !isRepoKey(this.newForm.focus)) return;
    const choices = this.newForm.fields[this.newForm.focus].suggestions ?? [];
    if (!choices.length) return;
    this.mode = "repoPicker";
    this.repoPicker = createRepoPicker(choices);
    this.repoPickerTarget = this.newForm.focus;
  }

  private handleRepoPickerInput(data: string) {
    if (!this.repoPicker) {
      this.mode = this.newForm ? "new" : "normal";
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.mode = this.newForm ? "new" : "normal";
      this.repoPicker = undefined;
      this.repoPickerTarget = undefined;
      return;
    }
    if (matchesKey(data, Key.down)) this.repoPicker = moveRepoPickerSelection(this.repoPicker, 1);
    else if (matchesKey(data, Key.up)) this.repoPicker = moveRepoPickerSelection(this.repoPicker, -1);
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") this.applyRepoPickerSelection();
    else {
      const edited = editTextInput(data, this.repoPicker.filter);
      if (edited) this.repoPicker = { ...this.repoPicker, filter: edited, selected: 0 };
    }
  }

  private applyRepoPickerSelection() {
    const cwd = this.repoPicker ? selectedRepoCwd(this.repoPicker) : undefined;
    if (!cwd) return;
    if (this.newForm && this.repoPickerTarget) this.newForm = setRepoValue(this.newForm, this.repoPickerTarget, cwd);
    this.mode = this.newForm ? "new" : "normal";
    this.repoPicker = undefined;
    this.repoPickerTarget = undefined;
  }

  private submitForkDialog() {
    const selected = this.controller.selected();
    if (!selected || !this.forkForm) return;
    const result = validateRequired(this.forkForm);
    this.forkForm = result.state;
    if (!result.ok) return;
    const group = result.state.fields.group.value;
    const title = result.state.fields.title.value;
    this.runAction(() => this.actions.forkSession?.(selected.id, { group, title }), "forking session...");
    this.mode = "normal";
    this.forkForm = undefined;
  }

  private submitGroupDialog() {
    const selected = this.controller.selected();
    if (!selected || !this.moveGroupForm) return;
    const result = validateRequired(this.moveGroupForm);
    this.moveGroupForm = result.state;
    if (!result.ok) return;
    const group = result.state.fields.group.value;
    this.runAction(() => this.actions.changeGroup ? this.actions.changeGroup(selected.id, group) : this.controller.moveSessionToGroup(selected.id, group), "moving session...");
    this.mode = "normal";
    this.moveGroupForm = undefined;
  }

  private submitRenameSessionDialog() {
    const selected = this.controller.selected();
    if (!selected || !this.renameSessionForm) return;
    const result = validateRequired(this.renameSessionForm);
    this.renameSessionForm = result.state;
    if (!result.ok) return;
    const title = result.state.fields.title.value;
    const returnTmuxSession = this.returnAfterRenameTmuxSession;
    this.returnAfterRenameTmuxSession = undefined;
    this.runAction(
      () => this.actions.renameSession ? this.actions.renameSession(selected.id, title) : this.controller.renameSession(selected.id, title),
      "renaming session...",
      () => { if (returnTmuxSession) this.attachSession(selected); },
    );
    this.mode = "normal";
    this.renameSessionForm = undefined;
  }

  private submitRenameGroupDialog() {
    const from = this.renameGroupFrom;
    if (!from || !this.renameGroupForm) {
      this.mode = "normal";
      return;
    }
    const to = this.renameGroupForm.fields.to.value.trim();
    if (!to) {
      this.renameGroupForm = setFieldError(this.renameGroupForm, "to", "group is required");
      return;
    }
    this.runAction(() => this.actions.renameGroup ? this.actions.renameGroup(from, to) : this.controller.renameGroup(from, to), "renaming group...");
    this.mode = "normal";
    this.renameGroupFrom = undefined;
    this.renameGroupForm = undefined;
  }

  private runAction(action: () => unknown, pendingMessage: string, onSuccess?: () => void): void {
    try {
      const result = action();
      if (!isPromise(result)) {
        onSuccess?.();
        return;
      }
      this.busy = true;
      this.message = pendingMessage;
      void result.then(() => {
        this.busy = false;
        onSuccess?.();
        if (this.message === pendingMessage) this.message = undefined;
      }).catch((error: unknown) => {
        this.busy = false;
        this.message = errorMessage(error);
      });
    } catch (error) {
      this.message = errorMessage(error);
    }
  }

  private renderRestartDialog(width: number): string[] {
    const selected = this.controller.selected();
    return renderDialog("Restart session", [
      selected ? `target  ${selected.title}` : "target  none",
      "",
      confirmLine("warning", this.message ?? "press R again to confirm", this.theme),
      "  esc cancel",
    ], width, this.theme);
  }

  private renderDeleteDialog(width: number): string[] {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.deleteTargetId);
    const subagents = this.subagentTargets(target?.id);
    const action = this.deleting === "subagents" ? "closing subagents..." : this.deleting ? "deleting..." : this.message ?? "press d again to delete";
    const choices = subagents.length && target?.kind !== "subagent"
      ? [
        `This session has ${subagents.length} ${subagents.length === 1 ? "subagent" : "subagents"}.`,
        "",
        this.deleting || this.message ? action : confirmLine("warning", "s close subagents only", this.theme),
        this.deleting || this.message ? "" : confirmLine("error", "d delete session + subagents", this.theme),
      ]
      : [this.deleting || this.message ? action : confirmLine("error", action, this.theme)];
    return renderDialog("Delete session", [
      target ? `target  ${target.title}` : "target  none",
      "",
      "Removes this session from pi-sessions.",
      "Pi conversation files are kept.",
      "",
      ...choices.filter(Boolean),
      "  esc cancel",
    ], width, this.theme);
  }

  private subagentTargets(parentId: string | undefined): ManagedSession[] {
    if (!parentId) return [];
    const sessions = this.controller.snapshot().registry.sessions;
    const target = sessions.find((session) => session.id === parentId);
    if (!target || target.kind === "subagent") return [];
    const ids = sessionCascadeIds(sessions, parentId);
    ids.delete(parentId);
    return sessions.filter((session) => ids.has(session.id));
  }

  private renderNewForm(width: number): string[] {
    if (!this.newForm) return [];
    return renderForm({
      title: "New session",
      fields: this.newForm.order.map((key) => this.newForm!.fields[key]),
      focus: this.newForm.focus,
      footer: newFormFooter(this.newForm),
      narrowFooter: "tab · alt-a · enter · esc",
    }, width, this.theme);
  }

  private renderSessionDialog(width: number): string[] {
    if (!this.forkForm) return [];
    return renderForm({
      title: "Fork session",
      fields: this.forkForm.order.map((key) => this.forkForm!.fields[key]),
      focus: this.forkForm.focus,
      footer: "tab next · ←→ edit · enter fork · esc cancel",
      narrowFooter: "tab · enter · esc",
    }, width, this.theme);
  }

  private renderGroupDialog(width: number): string[] {
    if (!this.moveGroupForm) return [];
    return renderForm({
      title: "Move to group",
      fields: this.moveGroupForm.order.map((key) => this.moveGroupForm!.fields[key]),
      focus: this.moveGroupForm.focus,
      footer: "←→ edit · enter move · esc cancel",
      narrowFooter: "enter · esc",
    }, width, this.theme);
  }

  private renderRenameSessionDialog(width: number): string[] {
    if (!this.renameSessionForm) return [];
    return renderForm({
      title: "Rename session",
      fields: this.renameSessionForm.order.map((key) => this.renameSessionForm!.fields[key]),
      focus: this.renameSessionForm.focus,
      footer: "←→ edit · enter rename · esc cancel",
      narrowFooter: "enter · esc",
    }, width, this.theme);
  }

  private renderRenameGroupDialog(width: number): string[] {
    if (!this.renameGroupForm) return [];
    return renderForm({
      title: "Rename group",
      fields: this.renameGroupForm.order.map((key) => this.renameGroupForm!.fields[key]),
      focus: this.renameGroupForm.focus,
      footer: "←→ edit · enter rename · esc cancel",
      narrowFooter: "enter · esc",
    }, width, this.theme);
  }

  private handleFilterInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.filterDraft = createTextInput();
      this.controller.setFilter(undefined);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      this.mode = "normal";
      this.controller.setFilter(this.filterDraft.value);
      return;
    }
    const edited = editTextInput(data, this.filterDraft);
    if (edited) {
      this.filterDraft = edited;
      this.controller.setFilter(this.filterDraft.value);
    }
  }
}

function editPickerSearch(data: string, picker: PickerState): PickerState | undefined {
  const edited = editTextInput(data, createTextInput(picker.filter ?? "", picker.filterCursor));
  if (!edited) return undefined;
  return { ...picker, filter: edited.value, filterCursor: edited.cursor, selected: 0 };
}

function editNewFormState(data: string, state: NewFormState): NewFormState | undefined {
  if (matchesKey(data, Key.left)) return moveCursor(state, -1);
  if (matchesKey(data, Key.right)) return moveCursor(state, 1);
  if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) return moveCursorHome(state);
  if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) return moveCursorEnd(state);
  if (wordLeft(data)) return moveCursorWordLeft(state);
  if (wordRight(data)) return moveCursorWordRight(state);
  if (matchesKey(data, Key.backspace)) return backspace(state);
  if (matchesKey(data, Key.delete)) return deleteForward(state);
  if (wordBackspace(data)) return backspaceWord(state);
  if (wordDelete(data)) return deleteWord(state);
  if (isPrintable(data)) return appendChar(state, data);
  return undefined;
}

function editFormState<K extends string>(data: string, state: FormState<K>): FormState<K> | undefined {
  if (matchesKey(data, Key.left)) return moveFieldCursor(state, -1);
  if (matchesKey(data, Key.right)) return moveFieldCursor(state, 1);
  if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) return moveFieldCursorHome(state);
  if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) return moveFieldCursorEnd(state);
  if (wordLeft(data)) return moveFieldCursorWordLeft(state);
  if (wordRight(data)) return moveFieldCursorWordRight(state);
  if (matchesKey(data, Key.backspace)) return backspaceForm(state);
  if (matchesKey(data, Key.delete)) return deleteFormForward(state);
  if (wordBackspace(data)) return backspaceFieldWord(state);
  if (wordDelete(data)) return deleteFieldWord(state);
  if (isPrintable(data)) return appendFormChar(state, data);
  return undefined;
}

function editTextInput(data: string, state: TextInputState): TextInputState | undefined {
  if (matchesKey(data, Key.left)) return moveTextCursor(state, -1);
  if (matchesKey(data, Key.right)) return moveTextCursor(state, 1);
  if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) return moveTextCursorHome(state);
  if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) return moveTextCursorEnd(state);
  if (wordLeft(data)) return moveTextCursorWordLeft(state);
  if (wordRight(data)) return moveTextCursorWordRight(state);
  if (matchesKey(data, Key.backspace)) return backspaceText(state);
  if (matchesKey(data, Key.delete)) return deleteText(state);
  if (wordBackspace(data)) return backspaceTextWord(state);
  if (wordDelete(data)) return deleteTextWord(state);
  if (isPrintable(data)) return insertText(state, data);
  return undefined;
}

function wordLeft(data: string): boolean {
  return matchesKey(data, Key.ctrl("left")) || matchesKey(data, Key.alt("left"));
}

function wordRight(data: string): boolean {
  return matchesKey(data, Key.ctrl("right")) || matchesKey(data, Key.alt("right"));
}

function wordBackspace(data: string): boolean {
  return matchesKey(data, Key.ctrl("backspace")) || matchesKey(data, Key.alt("backspace")) || matchesKey(data, Key.ctrl("w"));
}

function wordDelete(data: string): boolean {
  return matchesKey(data, Key.ctrl("delete")) || matchesKey(data, Key.alt("delete")) || matchesKey(data, Key.alt("d"));
}

function filterFooter(input: TextInputState, theme?: SessionsTheme): string {
  const text = `filter: ${renderInlineInput(input)}  • ←→ edit • esc clear • enter done`;
  return theme ? styleToken(theme, "dim", text) : text;
}

function renderInlineInput(input: TextInputState): string {
  const chars = [...input.value];
  const cursor = Math.max(0, Math.min(input.cursor, chars.length));
  return `${chars.slice(0, cursor).join("")}█${chars.slice(cursor).join("")}`;
}

function confirmLine(token: "warning" | "error", text: string, theme?: SessionsTheme): string {
  const line = `▶ ${text}`;
  return theme ? styleToken(theme, token, line) : line;
}

function setFieldError<K extends string>(state: FormState<K>, key: K, error: string): FormState<K> {
  return {
    ...state,
    fields: { ...state.fields, [key]: { ...state.fields[key], error } },
    focus: key,
  };
}

function isPrintable(data: string): boolean {
  return [...data].length === 1 && data >= " " && data !== "\u007f";
}

function newFormFooter(state: NewFormState): string {
  const focus = state.fields[state.focus];
  const repoHasSuggestions = state.focus.startsWith("repo:") && (focus.suggestions?.length ?? 0) > 1;
  const repoCanChoose = state.focus.startsWith("repo:") && (focus.suggestions?.length ?? 0) > 0;
  const removableRepo = state.focus.startsWith("repo:") && state.focus !== "repo:0";
  const parts = ["tab/↓ next", "shift-tab/↑ prev", "←→ edit", "alt-a add repo"];
  if (removableRepo) parts.push("alt-x remove extra");
  if (repoCanChoose) parts.push("ctrl-o choose");
  if (repoHasSuggestions) parts.push("ctrl-n/p cycle");
  parts.push("enter create", "esc cancel");
  return parts.join(" · ");
}

function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderHelp(width: number): string[] {
  const lines = [
    "pi sessions help",
    "",
    "navigation   ↑↓/j/k move cursor   K/J reorder   / filter",
    "sessions     enter attach   n new   r rename   f fork   g/G group   R restart   d delete   a mark read",
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
