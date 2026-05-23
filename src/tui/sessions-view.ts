import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { attachPlan, restartConfirmMessage } from "../app/actions.js";
import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import { sessionCascadeIds } from "../core/session-tree.js";
import { isWorktreeSession } from "../core/worktree.js";
import type { ManagedSession } from "../core/types.js";
import { buildRenderModel } from "./render-model.js";
import { renderSessions, renderDialog, renderForm } from "./layout.js";
import { stripAnsi, styleToken, type SessionsTheme } from "./theme.js";
import { movePickerSelection, renderTwoColumnPicker, switchPickerColumn, togglePickerItem, type PickerState, type PickerItem } from "./two-column-picker.js";
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
  toggleWorktree,
  validateNewForm,
  isRepoKey,
  type NewFormContext,
  type NewFormState,
  type NewFormSubmission,
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
  worktree?: { branch: string };
}

export interface SessionsViewActions {
  attachOutsideTmux?: (tmuxSession: string) => void | Promise<void>;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  restart?: (sessionId: string) => unknown;
  restartNew?: (sessionId: string) => unknown;
  deleteSession?: (sessionId: string) => void | Promise<void>;
  closeSubagents?: (sessionId: string) => void | Promise<void>;
  discardWorktree?: (sessionId: string) => void | Promise<void>;
  finishWorktree?: (sessionId: string) => void | Promise<void>;
  createSession?: (input: NewFormSubmission) => unknown;
  forkSession?: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => unknown;
  changeGroup?: (sessionId: string, group: string) => unknown;
  renameSession?: (sessionId: string, title: string) => unknown;
  syncPiName?: (sessionId: string) => SyncPiNameResult | Promise<SyncPiNameResult>;
  renameGroup?: (from: string, to: string) => unknown;
  reorderSelected?: (delta: -1 | 1) => unknown;
  acknowledge?: () => unknown;
  newFormContext?: () => NewFormContext;
  skills?: () => PickerItem[] | Promise<PickerItem[]>;
  applySkills?: (items: PickerItem[]) => void | Promise<void>;
  skillPoolDir?: () => string | undefined;
  skillPoolDirExtraCount?: () => number;
  saveSkillPoolDir?: (dir: string) => PickerItem[] | Promise<PickerItem[]>;
  mcpServers?: () => PickerItem[] | Promise<PickerItem[]>;
  applyMcpServers?: (items: PickerItem[]) => void | Promise<void>;
  sendMessage?: (tmuxSession: string, message: string) => unknown;
  copy?: (text: string) => void;
  skillCount?: (cwd: string) => number | undefined;
  now?: () => number;
  terminalRows?: () => number;
}

export class SessionsView implements Component {
  private mode: "normal" | "filter" | "help" | "new" | "repoPicker" | "fork" | "group" | "rename" | "renameDialog" | "groupRename" | "send" | "skills" | "mcp" | "delete" | "finish" = "normal";
  private filterDraft: TextInputState = createTextInput();
  private newForm: NewFormState | undefined;
  private repoPicker: RepoPickerState | undefined;
  private repoPickerTarget: RepoFieldKey | undefined;
  private forkForm: FormState<"group" | "title"> | undefined;
  private moveGroupForm: FormState<"group"> | undefined;
  private renameDraft: TextInputState = createTextInput();
  private renameError: string | undefined;
  private renameSessionForm: FormState<"title"> | undefined;
  private renameGroupForm: FormState<"to"> | undefined;
  private sendDraft: TextInputState = createTextInput();
  private sendError: string | undefined;
  private picker: PickerState | undefined;
  private message: string | undefined;
  private flash: { text: string; expiresAt: number } | undefined;
  private detailsExpanded = false;
  private pendingRestart: { sessionId: string; expiresAt: number } | undefined;
  private pickerSaveId = 0;
  private deleteTargetId: string | undefined;
  private sendTargetId: string | undefined;
  private renameGroupFrom: string | undefined;
  private returnAfterRenameTmuxSession: string | undefined;
  private busy = false;
  private deleting: false | "session" | "subagents" | "worktree" = false;
  private finishTargetId: string | undefined;
  private finishing = false;

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
      this.handleRenameInput(data);
      return;
    }

    if (this.mode === "renameDialog") {
      this.handleFormInput(data, this.renameSessionForm, (state) => { this.renameSessionForm = state; }, () => this.submitRenameSessionDialog());
      return;
    }

    if (this.mode === "groupRename") {
      this.handleFormInput(data, this.renameGroupForm, (state) => { this.renameGroupForm = state; }, () => this.submitRenameGroupDialog());
      return;
    }

    if (this.mode === "send") {
      this.handleSendInput(data);
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

    if (this.mode === "finish") {
      this.handleFinishInput(data);
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
      this.clearFlash();
      if (this.controller.snapshot().filter !== undefined) this.controller.setFilter(undefined);
      return;
    }

    if (this.pendingRestart) {
      const now = this.actions.now?.() ?? Date.now();
      if (this.pendingRestart.expiresAt <= now) this.clearPendingRestart();
      else {
        if (data === "R") this.confirmRestartSelected(false);
        else if (data === "N") this.confirmRestartSelected(true);
        return;
      }
    }

    if (data === "J" || matchesKey(data, Key.shift("down"))) this.reorderSelected(1);
    else if (data === "K" || matchesKey(data, Key.shift("up"))) this.reorderSelected(-1);
    else if (data === "N") this.syncPiNameSelected();
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
    else if (data === "p") this.startSendDialog();
    else if (data === "R") this.restartSelected();
    else if (data === "d") this.startDeleteDialog();
    else if (data === "w") this.startFinishDialog();
    else if (data === "s") this.startPicker("skills");
    else if (data === "m") this.startPicker("mcp");
    else if (data === "i") {
      this.clearPendingRestart();
      this.clearFlash();
      this.detailsExpanded = !this.detailsExpanded;
    }
    else if (data === "a") {
      this.clearPendingRestart();
      this.clearFlash();
      this.runAction(() => this.actions.acknowledge ? this.actions.acknowledge() : this.controller.acknowledgeSelected(), "marking read...");
    }
    else if (data === "?") {
      this.clearPendingRestart();
      this.clearFlash();
      this.mode = "help";
    }
    else if (data === "q") this.stop();
  }

  render(width: number): string[] {
    this.clearExpiredConfirmation();
    this.clearExpiredFlash();
    if (this.mode === "help") return renderHelp(width);
    if ((this.mode === "skills" || this.mode === "mcp") && this.picker) return renderTwoColumnPicker(this.picker, width, this.theme);
    if (this.mode === "repoPicker" && this.repoPicker) return renderRepoPicker(this.repoPicker, width, this.theme);
    if (this.mode === "new" && this.newForm) return this.renderNewForm(width);
    if (this.mode === "fork") return this.renderSessionDialog(width);
    if (this.mode === "group") return this.renderGroupDialog(width);
    if (this.mode === "renameDialog") return this.renderRenameSessionDialog(width);
    if (this.mode === "groupRename") return this.renderRenameGroupDialog(width);
    if (this.mode === "delete") return this.renderDeleteDialog(width);
    if (this.mode === "finish") return this.renderFinishDialog(width);
    if (this.pendingRestart) return this.renderRestartDialog(width);
    const snapshot = this.controller.snapshot();
    const selected = this.controller.selected();
    const lines = renderSessions(buildRenderModel({
      sessions: snapshot.registry.sessions,
      selectedId: snapshot.selectedId,
      width,
      filter: this.mode === "filter" ? this.filterDraft.value : snapshot.filter,
      filterEditing: this.mode === "filter",
      preview: snapshot.preview,
      detailsExpanded: this.detailsExpanded,
      height: this.actions.terminalRows?.() ?? process.stdout.rows,
      selectedSkillCount: selected ? this.actions.skillCount?.(selected.cwd) : undefined,
    }), this.theme);
    const now = this.actions.now?.() ?? Date.now();
    const footer = this.mode === "filter"
      ? filterFooter(this.filterDraft, now, this.theme)
      : this.mode === "rename"
        ? renameFooter(this.renameDraft, this.renameTargetTitle(), this.renameError, now, this.theme)
        : this.mode === "send"
          ? sendFooter(this.sendDraft, this.sendTargetTitle(), this.sendError, now, this.theme)
          : undefined;
    const withFooter = footer ? replaceFooter(lines, footer, this.theme) : lines;
    if (this.message) return replaceFooter(withFooter, this.message, this.theme);
    return this.flash ? replaceFooter(withFooter, this.flash.text, this.theme) : withFooter;
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
    return this.mode === "renameDialog";
  }

  private startFilter() {
    if (this.controller.snapshot().registry.sessions.length === 0) return;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.mode = "filter";
    this.filterDraft = createTextInput(this.controller.snapshot().filter ?? "");
    this.controller.setFilter(this.filterDraft.value);
  }

  private startNewDialog() {
    this.clearPendingRestart();
    this.clearFlash();
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
    if (isWorktreeSession(selected)) {
      this.message = "worktree sessions cannot be forked in v1";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
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
    this.clearFlash();
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
    this.clearFlash();
    this.returnAfterRenameTmuxSession = returnAfterRenameTmuxSession;
    if (returnAfterRenameTmuxSession) {
      this.mode = "renameDialog";
      this.renameSessionForm = createForm<"title">([
        { key: "title", label: "title", value: selected.title, hint: "session display title" },
      ]);
    } else {
      this.mode = "rename";
      this.renameDraft = createTextInput(selected.title);
      this.renameError = undefined;
    }
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
    this.clearFlash();
    this.mode = "groupRename";
    this.renameGroupFrom = selected.group;
    this.renameGroupForm = createForm<"to">([
      { key: "to", label: "to", value: selected.group, hint: `renames all sessions currently in ${selected.group}` },
    ]);
    this.message = undefined;
  }

  private startSendDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot receive input";
      return;
    }
    if (selected.status === "stopped" || selected.status === "error") {
      this.message = "session is not live; press R to restart";
      return;
    }
    if (!this.actions.sendMessage) {
      this.message = "send unavailable";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.mode = "send";
    this.sendTargetId = selected.id;
    this.sendDraft = createTextInput();
    this.sendError = undefined;
    this.message = undefined;
  }

  private startPicker(mode: "skills" | "mcp") {
    this.clearPendingRestart();
    this.clearFlash();
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
    const poolDir = mode === "skills" ? this.actions.skillPoolDir?.() : undefined;
    if (!items.length && !(mode === "skills" && poolDir !== undefined)) {
      this.message = `${mode}: nothing available`;
      return;
    }
    this.mode = mode;
    this.picker = {
      title: mode === "skills" ? "Skills" : "MCP — [project]",
      items,
      selected: 0,
      ...(mode === "skills" && poolDir !== undefined ? { poolDir, poolDirExtraCount: this.actions.skillPoolDirExtraCount?.() ?? 0 } : {}),
    };
    this.message = undefined;
  }

  private attachSelected() {
    this.clearPendingRestart();
    this.clearFlash();
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
            if (this.message === "marking read...") this.message = undefined;
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
      this.flashMessage(`switching: ${plan.command} · Ctrl+Q returns`);
      try {
        const result = switchInsideTmux(selected.tmuxSession);
        if (isPromise(result)) void result.catch((error: unknown) => { this.message = `switch failed: ${errorMessage(error)}`; });
      } catch (error) {
        this.message = `switch failed: ${errorMessage(error)}`;
      }
      return;
    }
    try {
      const result = this.actions.attachOutsideTmux?.(selected.tmuxSession);
      if (isPromise(result)) void result.catch((error: unknown) => { this.message = `attach failed: ${errorMessage(error)}`; });
    } catch (error) {
      this.message = `attach failed: ${errorMessage(error)}`;
    }
  }

  private reorderSelected(delta: -1 | 1) {
    this.clearPendingRestart();
    this.clearFlash();
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

  private syncPiNameSelected() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot sync Pi names";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    const sync = this.actions.syncPiName ?? ((sessionId: string) => this.controller.syncPiName(sessionId));
    try {
      const result = sync(selected.id);
      const apply = (syncResult: SyncPiNameResult) => { this.message = syncPiNameMessage(syncResult); };
      if (isPromise(result)) {
        this.busy = true;
        this.message = "syncing Pi name...";
        void result.then((syncResult) => {
          this.busy = false;
          apply(syncResult);
        }).catch((error: unknown) => {
          this.busy = false;
          this.message = errorMessage(error);
        });
      } else {
        apply(result);
      }
    } catch (error) {
      this.message = errorMessage(error);
    }
  }

  private restartSelected() {
    this.clearFlash();
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be restarted here";
      return;
    }
    const now = this.actions.now?.() ?? Date.now();
    if (this.pendingRestart?.sessionId === selected.id && this.pendingRestart.expiresAt > now) {
      this.confirmRestartSelected(false);
      return;
    }
    this.pendingRestart = { sessionId: selected.id, expiresAt: now + 2_000 };
    this.message = restartConfirmMessage(selected.title);
  }

  private confirmRestartSelected(newConversation: boolean) {
    const selected = this.controller.selected();
    if (!selected || this.pendingRestart?.sessionId !== selected.id) return;
    this.pendingRestart = undefined;
    this.message = undefined;
    if (newConversation) {
      if (!this.actions.restartNew) {
        this.message = "new conversation restart unavailable";
        return;
      }
      this.runAction(() => this.actions.restartNew?.(selected.id), "restarting new conversation...");
      return;
    }
    this.runAction(() => this.actions.restart?.(selected.id), "restarting session...");
  }

  private startDeleteDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    this.clearPendingRestart();
    this.clearFlash();
    this.mode = "delete";
    this.deleteTargetId = selected.id;
    this.message = undefined;
  }

  private startFinishDialog() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be finished";
      return;
    }
    if (!isWorktreeSession(selected) || selected.worktreeOwnedByHub !== true) {
      this.message = "selected session is not a worktree";
      return;
    }
    if (!this.actions.finishWorktree) {
      this.message = "finish worktree unavailable";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.mode = "finish";
    this.finishTargetId = selected.id;
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
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.deleteTargetId);
    const closeSubagents = data === "s" && this.subagentTargets(this.deleteTargetId).length > 0;
    const discardWorktree = data === "D" && Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
    if ((data !== "d" && !closeSubagents && !discardWorktree) || this.deleting) return;
    const id = this.deleteTargetId;
    if (!id) {
      this.mode = "normal";
      return;
    }
    const action = closeSubagents ? this.actions.closeSubagents : discardWorktree ? this.actions.discardWorktree : this.actions.deleteSession;
    const successMessage = closeSubagents ? "subagents closed" : discardWorktree ? "worktree discarded" : "session deleted";
    try {
      this.deleting = closeSubagents ? "subagents" : discardWorktree ? "worktree" : "session";
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

  private handleFinishInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.finishing) return;
      this.mode = "normal";
      this.finishTargetId = undefined;
      this.message = undefined;
      return;
    }
    if (data !== "w" || this.finishing) return;
    const id = this.finishTargetId;
    if (!id) {
      this.mode = "normal";
      return;
    }
    try {
      this.finishing = true;
      const result = this.actions.finishWorktree?.(id);
      if (isPromise(result)) {
        void result.then(() => {
          this.finishing = false;
          this.mode = "normal";
          this.finishTargetId = undefined;
          this.message = "worktree finished";
        }).catch((error: unknown) => {
          this.finishing = false;
          this.message = errorMessage(error);
        });
      } else {
        this.finishing = false;
        this.mode = "normal";
        this.finishTargetId = undefined;
        this.message = "worktree finished";
      }
    } catch (error) {
      this.finishing = false;
      this.message = errorMessage(error);
    }
  }

  private clearPendingRestart() {
    const hadPendingRestart = Boolean(this.pendingRestart);
    this.pendingRestart = undefined;
    if (hadPendingRestart && this.message?.startsWith("press R")) this.message = undefined;
  }

  private flashMessage(text: string, ttlMs = 1_500): void {
    const now = this.actions.now?.() ?? Date.now();
    this.flash = { text, expiresAt: now + ttlMs };
  }

  private clearFlash(): void {
    this.flash = undefined;
  }

  private clearExpiredFlash(): void {
    if (!this.flash) return;
    const now = this.actions.now?.() ?? Date.now();
    if (this.flash.expiresAt <= now) this.flash = undefined;
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
    if (this.picker.poolPending) return;
    if (this.mode === "skills" && this.picker.poolInput) {
      this.handleSkillPoolInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.picker = undefined;
      return;
    }
    if (this.mode === "skills" && matchesKey(data, Key.alt("e"))) this.picker = { ...this.picker, poolInput: createTextInput(this.picker.poolDir ?? ""), poolError: undefined, poolMessage: undefined };
    else if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) this.picker = switchPickerColumn(this.picker);
    else if (matchesKey(data, Key.down)) this.picker = movePickerSelection(this.picker, 1);
    else if (matchesKey(data, Key.up)) this.picker = movePickerSelection(this.picker, -1);
    else if (matchesKey(data, Key.space) || data === " ") this.picker = togglePickerItem(this.picker);
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") this.applyPickerSelection();
    else {
      const edited = editPickerSearch(data, this.picker);
      if (edited) this.picker = { ...edited, poolError: undefined, poolMessage: undefined };
    }
  }

  private handleSkillPoolInput(data: string) {
    if (!this.picker?.poolInput) return;
    if (matchesKey(data, Key.escape)) {
      this.picker = { ...this.picker, poolInput: undefined, poolError: undefined, poolMessage: undefined };
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      const dir = this.picker.poolInput.value.trim();
      if (!dir) {
        this.picker = { ...this.picker, poolError: "skill pool dir cannot be blank", poolMessage: undefined };
        return;
      }
      const save = this.actions.saveSkillPoolDir;
      if (!save) {
        this.picker = { ...this.picker, poolError: "skill pool editing unavailable", poolMessage: undefined };
        return;
      }
      const saveId = ++this.pickerSaveId;
      this.picker = { ...this.picker, poolPending: true, poolMessage: "saving skill pool...", poolError: undefined };
      const applySaved = (items: PickerItem[]) => {
        if (this.mode !== "skills" || !this.picker || this.pickerSaveId !== saveId) return;
        this.picker = {
          ...this.picker,
          items,
          selected: 0,
          poolDir: this.actions.skillPoolDir?.() || dir,
          poolDirExtraCount: this.actions.skillPoolDirExtraCount?.() ?? 0,
          poolInput: undefined,
          poolPending: false,
          poolMessage: "skill pool saved; press enter to apply selected skills",
          poolError: undefined,
        };
      };
      const applyError = (error: unknown) => {
        if (this.mode !== "skills" || !this.picker || this.pickerSaveId !== saveId) return;
        this.picker = { ...this.picker, poolPending: false, poolError: errorMessage(error), poolMessage: undefined };
      };
      try {
        const result = save(dir);
        if (isPromise<PickerItem[]>(result)) void result.then(applySaved).catch(applyError);
        else applySaved(result);
      } catch (error) {
        applyError(error);
      }
      return;
    }
    const edited = editTextInput(data, this.picker.poolInput);
    if (edited) this.picker = { ...this.picker, poolInput: edited, poolError: undefined, poolMessage: undefined };
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
    if (matchesKey(data, Key.ctrl("t"))) {
      this.newForm = toggleWorktree(this.newForm);
      this.message = undefined;
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
    if (!selected) {
      this.clearRenamePrompt();
      return;
    }
    let title: string;
    if (this.mode === "renameDialog") {
      if (!this.renameSessionForm) return;
      const result = validateRequired(this.renameSessionForm);
      this.renameSessionForm = result.state;
      if (!result.ok) return;
      title = result.state.fields.title.value;
    } else {
      title = this.renameDraft.value.trim();
      if (!title) {
        this.renameError = "title is required";
        return;
      }
    }
    const returnTmuxSession = this.returnAfterRenameTmuxSession;
    this.runAction(
      () => this.actions.renameSession ? this.actions.renameSession(selected.id, title) : this.controller.renameSession(selected.id, title),
      "renaming session...",
      () => { if (returnTmuxSession) this.attachSession(selected); },
    );
    this.clearRenamePrompt();
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

  private submitSendDialog() {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.sendTargetId);
    if (!target) {
      this.clearSendPrompt();
      return;
    }
    const message = this.sendDraft.value.trim();
    if (!message) {
      this.sendError = "message is required";
      return;
    }
    this.runAction(
      () => this.actions.sendMessage?.(target.tmuxSession, message),
      "sending message...",
      () => { this.flashMessage(`sent → ${target.title}`); },
    );
    this.clearSendPrompt();
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
      confirmLine("warning", this.message ?? "press R to restart, N for new conversation", this.theme),
      "  esc cancel",
    ], width, this.theme);
  }

  private renderDeleteDialog(width: number): string[] {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.deleteTargetId);
    const subagents = this.subagentTargets(target?.id);
    const action = this.deleting === "subagents" ? "closing subagents..." : this.deleting === "worktree" ? "discarding worktree..." : this.deleting ? "deleting..." : this.message ?? "press d again to delete";
    const worktree = Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
    const choices = deleteChoices({ action, busy: Boolean(this.deleting || this.message), subagentCount: subagents.length, targetIsSubagent: target?.kind === "subagent", worktree, theme: this.theme });
    return renderDialog("Delete session", [
      target ? `target  ${target.title}` : "target  none",
      "",
      worktree ? "Worktree session: choose whether to only forget it or discard the clean worktree." : "Removes this session from pi-agent-hub.",
      "Pi conversation files are kept.",
      ...(worktree ? ["d keeps worktree and branch; D deletes the clean worktree and branch; w merges instead."] : []),
      "",
      ...choices.filter(Boolean),
      "  esc cancel",
    ], width, this.theme);
  }

  private renderFinishDialog(width: number): string[] {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.id === this.finishTargetId);
    const branch = target?.worktreeBranch ?? "unknown";
    const base = target?.worktreeBaseBranch ?? "unknown";
    return renderDialog("Finish worktree", [
      target ? `target   ${target.title}` : "target   none",
      `branch   ${branch}`,
      `merge    ${branch} → ${base}`,
      "cleanup  remove hub-owned worktree, prune, delete merged branch",
      "",
      this.finishing || this.message ? (this.message ?? "finishing worktree...") : confirmLine("warning", "press w again to finish", this.theme),
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
      fields: newFormFields(this.newForm),
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

  private handleRenameInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.clearRenamePrompt();
      this.message = undefined;
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      this.submitRenameSessionDialog();
      return;
    }
    const edited = editTextInput(data, this.renameDraft);
    if (edited) {
      this.renameDraft = edited;
      this.renameError = undefined;
      this.message = undefined;
    }
  }

  private clearRenamePrompt() {
    this.mode = "normal";
    this.renameDraft = createTextInput();
    this.renameError = undefined;
    this.renameSessionForm = undefined;
    this.returnAfterRenameTmuxSession = undefined;
  }

  private renameTargetTitle(): string {
    return this.controller.selected()?.title ?? "session";
  }

  private handleSendInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.clearSendPrompt();
      this.message = undefined;
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r") {
      this.submitSendDialog();
      return;
    }
    const edited = editTextInput(data, this.sendDraft);
    if (edited) {
      this.sendDraft = edited;
      this.sendError = undefined;
      this.message = undefined;
    }
  }

  private clearSendPrompt() {
    this.mode = "normal";
    this.sendTargetId = undefined;
    this.sendDraft = createTextInput();
    this.sendError = undefined;
  }

  private sendTargetTitle(): string {
    return this.controller.snapshot().registry.sessions.find((session) => session.id === this.sendTargetId)?.title ?? "session";
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

function filterFooter(input: TextInputState, now: number, theme?: SessionsTheme): string {
  const text = `filter: ${renderInlineInput(input, footerCursor(now))}  • ←→ edit • esc clear • enter done`;
  return theme ? styleToken(theme, "dim", text) : text;
}

function renameFooter(input: TextInputState, target: string, error: string | undefined, now: number, theme?: SessionsTheme): string {
  const text = error
    ? `rename ${target}: ${renderInlineInput(input, footerCursor(now))}  • ${error}`
    : `rename ${target}: ${renderInlineInput(input, footerCursor(now))}  • ←→ edit • esc cancel • enter rename`;
  return theme ? styleToken(theme, error ? "error" : "dim", text) : text;
}

function sendFooter(input: TextInputState, target: string, error: string | undefined, now: number, theme?: SessionsTheme): string {
  const text = error
    ? `send to ${target}: ${renderInlineInput(input, footerCursor(now))}  • ${error}`
    : `send to ${target}: ${renderInlineInput(input, footerCursor(now))}  • ←→ edit • esc cancel • enter send`;
  return theme ? styleToken(theme, error ? "error" : "dim", text) : text;
}

function footerCursor(now: number): string {
  const marker = Math.floor(now / 1_000) % 2 === 0 ? "█" : "▌";
  return `\u001b[5m${marker}\u001b[25m`;
}

function renderInlineInput(input: TextInputState, marker = "█"): string {
  const chars = [...input.value];
  const cursor = Math.max(0, Math.min(input.cursor, chars.length));
  return `${chars.slice(0, cursor).join("")}${marker}${chars.slice(cursor).join("")}`;
}

function confirmLine(token: "warning" | "error", text: string, theme?: SessionsTheme): string {
  const line = `▶ ${text}`;
  return theme ? styleToken(theme, token, line) : line;
}

function deleteChoices(input: { action: string; busy: boolean; subagentCount: number; targetIsSubagent: boolean; worktree: boolean; theme?: SessionsTheme }): string[] {
  if (input.busy) return [input.action];
  const choices = [];
  if (input.subagentCount && !input.targetIsSubagent) {
    choices.push(`This session has ${input.subagentCount} ${input.subagentCount === 1 ? "subagent" : "subagents"}.`, "", confirmLine("warning", "s close subagents only", input.theme));
  }
  if (!input.worktree) {
    choices.push(confirmLine("error", input.subagentCount && !input.targetIsSubagent ? "d delete session + subagents" : input.action, input.theme));
    return choices;
  }
  choices.push(
    confirmLine("warning", input.subagentCount && !input.targetIsSubagent ? "d forget dashboard row + subagents only" : "d forget dashboard row only", input.theme),
    "  keeps worktree and branch",
    confirmLine("error", "D discard worktree and branch", input.theme),
    "  requires a clean worktree; does not merge",
    confirmLine("warning", "w finish instead — merge and remove", input.theme),
  );
  return choices;
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

function newFormFields(state: NewFormState) {
  const fields = [];
  for (const key of state.order) {
    if (key === "branch") fields.push(worktreeStatusField(state));
    if (key === "group" && !state.worktreeEnabled) fields.push(worktreeStatusField(state));
    fields.push(state.fields[key]);
  }
  return fields;
}

function worktreeStatusField(state: NewFormState) {
  return {
    key: "worktree",
    label: "worktree",
    value: state.worktreeEnabled ? "on · ctrl-t to disable" : "off · ctrl-t to enable",
    readonly: true,
  };
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

function syncPiNameMessage(result: SyncPiNameResult): string {
  switch (result.status) {
    case "synced": return `renamed from Pi name: ${result.name}`;
    case "unavailable": return "Pi session file not available yet";
    case "unnamed": return "no Pi name set";
  }
}

function renderHelp(width: number): string[] {
  const lines = [
    "pi agent hub help",
    "",
    "Navigation",
    "  ↑↓/j/k move selection     Enter open/switch     / filter",
    "  K/J reorder in group      q quit                Esc cancel/clear",
    "",
    "Sessions",
    "  n new     p send     r rename     N sync Pi name     f fork     w finish worktree",
    "  g move group     G rename group     R restart (R resume, N new)     d delete     a mark read",
    "",
    "Project state",
    "  s skills picker     m MCP picker",
    "",
    "Return from managed sessions",
    "  Ctrl+Q return to dashboard     Alt+R rename current session",
    "",
    "Status legend",
    "  ● running/starting     ◐ waiting     ○ idle     × error     - stopped",
    "  zero counts are hidden in group and top summary",
    "",
    "Metadata",
    "  i toggle compact/full selected-session info",
  ];
  const inner = Math.max(40, width) - 2;
  return [
    `┌${"─".repeat(inner)}┐`,
    ...lines.map((line) => `│${padVisibleLine(line, inner)}│`),
    `└${"─".repeat(inner)}┘`,
  ];
}

function padVisibleLine(line: string, width: number): string {
  const text = truncateVisible(line, width);
  return `${text}${" ".repeat(Math.max(0, width - stripAnsi(text).length))}`;
}

function replaceFooter(lines: string[], message: string, theme?: SessionsTheme): string[] {
  if (lines.length < 3) return lines;
  const copy = lines.slice();
  const footerIndex = copy.length - 2;
  const width = stripAnsi(copy[footerIndex] ?? "").length;
  const inner = Math.max(0, width - 2);
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  const text = truncateVisible(message, inner);
  copy[footerIndex] = `${border("│")}${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))}${border("│")}`;
  return copy;
}

function truncateVisible(value: string, width: number): string {
  if (width <= 1) return "";
  return truncateToWidth(value, width, "…");
}
