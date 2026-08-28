import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { attachPlan } from "../app/actions.js";
import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import type { ManagedSession } from "../core/types.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { effectiveSessionLifecycle } from "./archive-section.js";
import { buildDashboardCommands, commandForKey, type DashboardCommand, type DashboardCommandCapabilities } from "./dashboard-commands.js";
import {
  createCommandPalette,
  handleCommandPaletteInput,
  handleCommandPaletteMouse,
  normalizeCommandPalette,
  renderCommandPalette,
  type CommandPaletteRowTarget,
  type CommandPaletteState,
} from "./command-palette-dialog.js";
import { buildDashboardProjection, buildRenderModel, type DashboardProjection } from "./render-model.js";
import { renderSessions, renderStatusInfo, type SessionListTarget } from "./layout.js";
import { isMouseSequence, parseMouseEvent, type MouseEvent } from "./mouse.js";
import { stripAnsi, styleToken, type SessionsTheme } from "./theme.js";
import type { PickerItem } from "./two-column-picker.js";
import type { CollapsibleSection, SessionsViewState } from "./dialog.js";
import { errorMessage, isPromise, type CloseSidePaneResult, type DialogContext, type FocusSidePaneResult, type SessionDialog, type SessionsViewActions, type SidePaneActionResult } from "./dialog.js";

type AsyncAction<T> = () => T | Promise<T>;

function runSyncAsyncAction<T>(action: AsyncAction<T>, handlers: {
  pending: string;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string | undefined) => void;
  success: (result: T) => void;
  failure: (error: unknown) => void;
}): void {
  try {
    const result = action();
    if (!isPromise<T>(result)) {
      handlers.success(result);
      return;
    }
    handlers.setBusy(true);
    handlers.setMessage(handlers.pending);
    void result.then((value) => {
      handlers.setBusy(false);
      handlers.success(value);
      handlers.setMessage(undefined);
    }).catch((error: unknown) => {
      handlers.setBusy(false);
      handlers.failure(error);
    });
  } catch (error) {
    handlers.failure(error);
  }
}
import { handlePromptInput, openFilterPrompt, openSendPrompt, promptFilterValue, promptFooter } from "./prompt-dialog.js";
import { isEnterKey } from "./text-input.js";
import { handleFormDialogInput, openForkDialog, openMoveGroupDialog, openRenameGroupDialog, openRenameSessionForm, renderFormDialog } from "./form-dialogs.js";
import { handleConfirmInput, openDeleteDialog, openFinishDialog, renderConfirmDialog, renderRestartDialog } from "./confirm-dialogs.js";
import { createPickerDialog, handlePickerDialogInput, renderPickerDialog } from "./picker-dialog.js";
import { handleNewSessionInput, openNewSessionDialog, renderNewSessionDialog } from "./new-session-dialog.js";
import { createThemeDialog, handleThemeDialogInput, renderThemeDialog } from "./theme-dialog.js";

const MIN_RENDER_WIDTH = 40;
const DOUBLE_CLICK_MS = 400;

export class SessionsView implements Component {
  private dialog: SessionDialog | undefined;
  private message: string | undefined;
  private flash: { text: string; expiresAt: number } | undefined;
  private detailsExpanded = false;
  private narrowInfoSessionId: string | undefined;
  private lastWidth = 80;
  private grouping: "project" | "stage";
  private density: "compact" | "all-cards";
  private pendingRestart: { sessionId: string } | undefined;
  private pendingFocusSlot = false;
  private pendingCloseSlot = false;
  private lastMouseClick: { target: string; at: number } | undefined;
  private busy = false;
  private archiveExpanded = false;
  private archiveDisclosureSelected = false;
  private selectedSection: CollapsibleSection | undefined;
  private collapsedSections = new Set<CollapsibleSection>();
  private rowTargets: (SessionListTarget | undefined)[] = [];
  private paletteRowTargets: (CommandPaletteRowTarget | undefined)[] = [];
  private paletteBounds: { start: number; end: number } | undefined;
  private listWidth = 0;
  private listScrollTop = 0;
  private expandedBoardParentIds = new Set<string>();
  private expandedProjectParentIds = new Set<string>();
  private revealedSessionId: string | undefined;
  private themeLoadRequest = 0;
  private projection?: DashboardProjection;
  private projectionRegistry?: object;
  private projectionKey = "";
  private viewStateRevision = 0;

  constructor(private controller: SessionsController, private stop: () => void, private actions: SessionsViewActions = {}, private theme?: SessionsTheme) {
    this.grouping = actions.initialViewState?.grouping ?? "project";
    this.density = actions.initialViewState?.density ?? "compact";
    this.collapsedSections = new Set(actions.initialViewState?.collapsedSections ?? []);
  }

  setTheme(theme: SessionsTheme): void {
    this.theme = theme;
  }

  setMessage(message: string | undefined): void {
    this.message = message;
  }

  handleInput(data: string): void {
    if (this.narrowInfoSessionId && this.controller.selected()?.id !== this.narrowInfoSessionId) this.narrowInfoSessionId = undefined;
    if (this.narrowInfoSessionId) {
      if (data === "i" || matchesKey(data, Key.escape)) this.narrowInfoSessionId = undefined;
      return;
    }
    if (isMouseSequence(data)) {
      this.clearPendingFocusSlot();
      const event = parseMouseEvent(data);
      if (event && this.dialog?.kind === "commandPalette" && !this.busy) this.handlePaletteMouse(event);
      else if (event && !this.dialog && !this.busy) this.handleMouse(event);
      else if (event) this.lastMouseClick = undefined;
      return;
    }

    this.lastMouseClick = undefined;
    if (this.dialog) {
      if (this.dialog.kind === "help") {
        if (data === "q") this.stop();
        else if (matchesKey(data, Key.escape) || data === "?") this.dialog = undefined;
      } else if (this.dialog.kind === "commandPalette") this.handlePaletteInput(data);
      else if (this.dialog.kind === "prompt") this.dialog = handlePromptInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "form") this.dialog = handleFormDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "confirm") this.dialog = handleConfirmInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "picker") this.dialog = handlePickerDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "theme") this.dialog = handleThemeDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "new" || this.dialog.kind === "repoPicker") this.dialog = handleNewSessionInput(this.dialog, data, this.dialogContext());
      return;
    }

    if (this.busy) {
      if (data === "q") {
        this.themeLoadRequest += 1;
        this.stop();
      }
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
      if (data === "r" || data === "R") this.confirmRestartSelected(false);
      else if (data === "n" || data === "N") this.confirmRestartSelected(true);
      else if (data === "a") this.confirmRestartAll();
      return;
    }

    if (this.pendingFocusSlot) {
      this.pendingFocusSlot = false;
      this.clearFlash();
      const slot = sidePaneSlot(data);
      if (slot) {
        this.focusSidePane(slot);
        return;
      }
    }
    if (this.pendingCloseSlot) {
      this.pendingCloseSlot = false;
      this.clearFlash();
      const slot = sidePaneSlot(data);
      if (slot) {
        this.closeSidePane(slot);
        return;
      }
    }
    if (data === ":") {
      if (this.lastWidth >= MIN_RENDER_WIDTH) this.executeDashboardCommand("view:palette");
      return;
    }
    if (this.grouping === "stage" && !this.boardRows().length) {
      const command = commandForKey(this.dashboardCommands(false, "select a visible session first"), data);
      if (command) this.executeDashboardCommand(command.id);
      return;
    }
    if (this.archiveDisclosureSelected || this.selectedSection) {
      if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
      else if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
      else if (isEnterKey(data)) this.selectedSection ? this.toggleSection(this.selectedSection) : this.toggleArchiveDisclosure();
      else if (data === "i") this.toggleInfo();
      else {
        const command = commandForKey(this.dashboardCommands(false, "select a session first"), data);
        if (command) this.executeDashboardCommand(command.id);
      }
      return;
    }

    const filterActive = Boolean(this.controller.snapshot().filter?.trim());
    if (!filterActive && matchesKey(data, Key.shift("right"))) {
      this.setAllSubagents(true);
      return;
    }
    if (!filterActive && matchesKey(data, Key.shift("left"))) {
      this.setAllSubagents(false);
      return;
    }
    if (!filterActive && matchesKey(data, Key.right)) {
      this.setSelectedSubagents(true);
      return;
    }
    if (!filterActive && matchesKey(data, Key.left)) {
      this.setSelectedSubagents(false);
      return;
    }
    if (this.grouping === "stage" && data === " ") {
      if (!filterActive) this.toggleBoardSubagents();
      return;
    }
    const command = commandForKey(this.dashboardCommands(), data);
    if (command) {
      this.executeDashboardCommand(command.id);
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      this.clearPendingRestart();
      this.moveSelection(1);
    }
    else if (matchesKey(data, Key.up) || data === "k") {
      this.clearPendingRestart();
      this.moveSelection(-1);
    }
  }

  render(width: number): string[] {
    this.clearExpiredFlash();
    this.lastWidth = width;
    const selectedId = this.controller.selected()?.id;
    if (this.revealedSessionId && selectedId !== this.revealedSessionId) this.revealedSessionId = undefined;
    if (this.narrowInfoSessionId && selectedId !== this.narrowInfoSessionId) this.narrowInfoSessionId = undefined;
    if (this.narrowInfoSessionId && width >= 80) {
      this.narrowInfoSessionId = undefined;
      this.detailsExpanded = true;
    }
    const height = this.actions.terminalRows?.() ?? process.stdout.rows;
    if (width < MIN_RENDER_WIDTH) {
      this.rowTargets = [];
      this.listWidth = 0;
      return limitRows(narrowNotice(width), height, width, this.theme);
    }
    if (this.dialog?.kind === "commandPalette" && height && height < 9) {
      const commands = this.dashboardCommands();
      this.dialog = { ...this.dialog, state: normalizeCommandPalette(this.dialog.state, commands) };
      const palette = renderCommandPalette(this.dialog.state, commands, width, height, this.theme);
      this.paletteRowTargets = palette.rowTargets;
      this.paletteBounds = { start: 0, end: Math.max(0, height - 1) };
      return palette.lines;
    }
    if (this.dialog?.kind === "help") return limitRows(renderHelp(width, this.theme, this.dashboardCommands()), height, width, this.theme);
    if (this.dialog?.kind === "picker") return limitRows(renderPickerDialog(this.dialog, width, this.dialogContext()), height, width, this.theme);
    if (this.dialog?.kind === "theme") return limitRows(renderThemeDialog(this.dialog, width, height, this.theme), height, width, this.theme);
    if (this.dialog?.kind === "new" || this.dialog?.kind === "repoPicker") return limitRows(renderNewSessionDialog(this.dialog, width, this.dialogContext()), height, width, this.theme);
    if (this.dialog?.kind === "form") return limitRows(renderFormDialog(this.dialog, width, this.dialogContext()), height, width, this.theme);
    if (this.dialog?.kind === "confirm") return limitRows(renderConfirmDialog(this.dialog, width, this.dialogContext()), height, width, this.theme);
    if (this.pendingRestart) return limitRows(renderRestartDialog(width, this.dialogContext()), height, width, this.theme);
    this.normalizeListSelection();
    const snapshot = this.controller.snapshot();
    const selected = this.controller.selected();
    const now = this.actions.now?.() ?? Date.now();
    const sidePaneSessionIds = this.actions.sidePaneSessionIds?.();
    const filter = (this.dialog?.kind === "prompt" ? (promptFilterValue(this.dialog) ?? snapshot.filter) : snapshot.filter)?.trim() || undefined;
    const structuralProjection = this.dashboardProjection(snapshot);
    const model = buildRenderModel({
      sessions: snapshot.sessions,
      selectedId: snapshot.selectedId,
      width,
      filter,
      filterEditing: this.dialog?.kind === "prompt" && this.dialog.purpose === "filter",
      preview: snapshot.preview,
      detailsExpanded: this.detailsExpanded,
      height,
      listScrollTop: this.listScrollTop,
      selectedSkillCount: selected ? this.actions.skillCount?.(selected.cwd) : undefined,
      grouping: this.grouping,
      density: this.density,
      now,
      sidePaneSessionIds,
      sidePaneFocusedSlot: this.actions.sidePaneFocusedSlot?.(),
      archiveExpanded: this.archiveExpanded,
      archiveDisclosureSelected: this.archiveDisclosureSelected,
      selectedSection: this.selectedSection,
      collapsedSections: this.collapsedSections,
      hidePreview: Boolean(sidePaneSessionIds?.size),
      expandedBoardParentIds: this.expandedBoardParentIds,
      expandedProjectParentIds: this.expandedProjectParentIds,
      revealedSessionId: this.revealedSessionId,
      structuralProjection,
    });
    const layout = this.narrowInfoSessionId && model.selected?.id === this.narrowInfoSessionId
      ? renderStatusInfo(model.selected, width, height, now, this.theme)
      : renderSessions(model, this.theme);
    this.rowTargets = layout.rowTargets;
    this.listWidth = layout.listWidth;
    this.listScrollTop = layout.listScrollTop;
    const footer = this.dialog?.kind === "prompt" ? promptFooter(this.dialog, this.dialogContext()) : undefined;
    let withFooter = footer ? replaceFooter(layout.lines, footer, this.theme) : layout.lines;
    this.paletteRowTargets = [];
    this.paletteBounds = undefined;
    if (this.dialog?.kind === "commandPalette") {
      const commands = this.dashboardCommands();
      this.dialog = { ...this.dialog, state: normalizeCommandPalette(this.dialog.state, commands) };
      const overlay = overlayCommandPalette(withFooter, this.dialog.state, commands, width, this.theme);
      withFooter = overlay.lines;
      this.paletteRowTargets = overlay.rowTargets;
      this.paletteBounds = overlay.bounds;
    }
    const final = this.message
      ? replaceFooter(withFooter, this.message, this.theme)
      : this.flash
        ? replaceFooter(withFooter, this.flash.text, this.theme)
        : withFooter;
    return limitRows(final, height, width, this.theme);
  }

  invalidate(): void {}

  openRenameForTmuxSession(tmuxSession: string): boolean {
    const target = this.controller.snapshot().registry.sessions.find((session) => session.tmuxSession === tmuxSession);
    if (!target) {
      this.message = `session not found: ${tmuxSession}`;
      return false;
    }
    const previousId = this.controller.snapshot().selectedId;
    this.controller.setFilter(undefined);
    if (!this.controller.selectSession(target.id)) return false;
    if (target.id !== previousId) this.actions.selectionChanged?.();
    this.startRenameSessionDialog(tmuxSession);
    return this.dialog?.kind === "form" && this.dialog.purpose === "renameSession";
  }

  private toggleInfo(): void {
    if (this.lastWidth >= 80 && this.detailsExpanded) {
      this.detailsExpanded = false;
      return;
    }
    if (this.lastWidth < 80) this.detailsExpanded = false;
    if (this.archiveDisclosureSelected || this.selectedSection) {
      this.flashMessage("select a session to show status evidence");
      return;
    }
    const selected = this.controller.selected();
    if (!selected) return;
    const selectedId = selected.id;
    const open = (requireEvidence = false) => {
      const current = this.controller.selected();
      if (current?.id !== selectedId) return;
      if (requireEvidence && !current.statusEvidence) {
        this.message = "status evidence unavailable after refresh";
        return;
      }
      if (this.lastWidth < 80) this.narrowInfoSessionId = selectedId;
      else this.detailsExpanded = true;
    };
    const refresh = this.actions.navigationActions?.refreshStatusEvidence ?? this.actions.refreshStatusEvidence;
    if (selected.statusEvidence || !refresh) {
      open();
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.runAction(() => refresh(), "refreshing status evidence...", () => open(true));
  }

  private dialogContext(): DialogContext {
    return {
      controller: this.controller,
      actions: this.actions,
      theme: this.theme,
      now: () => this.actions.now?.() ?? Date.now(),
      close: () => { this.dialog = undefined; },
      setDialog: (dialog) => { this.dialog = dialog; },
      dialog: () => this.dialog,
      setMessage: (message) => { this.message = message; },
      message: () => this.message,
      flashMessage: (text) => this.flashMessage(text),
      runAction: (action, pending, onSuccess) => this.runAction(action, pending, onSuccess),
      attachSession: (session) => this.attachSession(session),
      stop: () => this.stop(),
    };
  }

  private openDialog(open: (ctx: DialogContext) => SessionDialog | undefined) {
    const dialog = open(this.dialogContext());
    if (!dialog) return;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.dialog = dialog;
  }

  private startFilter() {
    this.revealedSessionId = undefined;
    this.openDialog(openFilterPrompt);
  }

  private startNewDialog() {
    this.openDialog(openNewSessionDialog);
  }

  private startForkDialog() {
    this.openDialog(openForkDialog);
  }

  private startGroupDialog() {
    this.openDialog(openMoveGroupDialog);
  }

  private startRenameSessionDialog(returnAfterRenameTmuxSession?: string) {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot be renamed";
      return;
    }
    this.openDialog((ctx) => openRenameSessionForm(ctx, returnAfterRenameTmuxSession));
  }

  private startRenameGroupDialog() {
    this.openDialog(openRenameGroupDialog);
  }

  private dashboardCommands(includeSelected = true, interactionBlockedReason?: string): DashboardCommand[] {
    const snapshot = this.controller.snapshot();
    const blockedReason = interactionBlockedReason ?? ((this.archiveDisclosureSelected || this.selectedSection || (this.grouping === "stage" && !this.boardRows().length))
      ? "select a visible session first"
      : undefined);
    const selected = includeSelected && !blockedReason ? this.controller.selected() : undefined;
    const selectedVisible = selected && (this.grouping !== "stage" || this.boardRows().some((row) => row.id === selected.id)) ? selected : undefined;
    const capabilities: DashboardCommandCapabilities = {
      openSession: Boolean(this.actions.attachOutsideTmux || this.actions.switchInsideTmux),
      restart: Boolean(this.actions.restart),
      deleteSession: Boolean(this.actions.deleteSession),
      finishWorktree: Boolean(this.actions.finishWorktree),
      forkSession: Boolean(this.actions.forkSession),
      renameSession: Boolean(this.actions.renameSession),
      syncPiName: true,
      sendMessage: Boolean(this.actions.sendMessage),
      runConfiguredShortcut: Boolean(this.actions.runDashboardShortcut),
      skills: Boolean(this.actions.skills),
      mcp: Boolean(this.actions.mcpServers),
      theme: Boolean(this.actions.themeSettings),
      resetSidePane: Boolean(this.actions.resetSidePane),
      assignSidePane: Boolean(this.actions.assignSidePaneSlot),
      closeSidePane: Boolean(this.actions.closeSidePaneSlot),
      focusSidePane: Boolean(this.actions.focusSidePaneSlot),
      acknowledge: true,
    };
    return buildDashboardCommands({
      sessions: this.commandSessions(snapshot),
      selectedId: selectedVisible?.id,
      filter: snapshot.filter,
      grouping: this.grouping,
      configuredShortcuts: this.actions.dashboardShortcuts,
      capabilities,
      interactionBlockedReason: blockedReason,
    });
  }

  private commandSessions(snapshot: ReturnType<SessionsController["snapshot"]>) {
    const unfiltered = buildDashboardProjection({
      sessions: snapshot.sessions,
      grouping: this.grouping,
      archiveExpanded: this.archiveExpanded,
      collapsedSections: this.collapsedSections,
      expandedBoardParentIds: this.expandedBoardParentIds,
      expandedProjectParentIds: this.expandedProjectParentIds,
      revealedSessionId: this.revealedSessionId,
    });
    const seen = new Set<string>();
    return [...unfiltered.visible, ...unfiltered.allRows].filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });
  }

  private openCommandPalette(): void {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const commands = this.dashboardCommands();
    this.dialog = { kind: "commandPalette", state: normalizeCommandPalette(createCommandPalette(), commands) };
  }

  private handlePaletteInput(data: string): void {
    if (this.dialog?.kind !== "commandPalette") return;
    const height = this.actions.terminalRows?.() ?? process.stdout.rows;
    if (height && height < 6 && isEnterKey(data)) return;
    const commands = this.dashboardCommands();
    const result = handleCommandPaletteInput(this.dialog.state, data, commands);
    if (result.kind === "close") {
      this.dialog = undefined;
      return;
    }
    if (result.kind === "execute") {
      this.executeDashboardCommand(result.commandId);
      return;
    }
    this.dialog = { ...this.dialog, state: result.state };
  }

  private handlePaletteMouse(event: MouseEvent): void {
    if (this.dialog?.kind !== "commandPalette") return;
    const row = event.kind === "press" ? event.y - 1 : undefined;
    if (row !== undefined && this.paletteBounds && row >= this.paletteBounds.start && row <= this.paletteBounds.end && !this.paletteRowTargets[row]) return;
    const commands = this.dashboardCommands();
    const result = handleCommandPaletteMouse(this.dialog.state, event, this.paletteRowTargets, commands);
    if (result.kind === "close") {
      this.dialog = undefined;
      return;
    }
    if (result.kind === "execute") {
      this.executeDashboardCommand(result.commandId);
      return;
    }
    this.dialog = { ...this.dialog, state: result.state };
  }

  private executeDashboardCommand(commandId: string): void {
    const command = this.dashboardCommands().find((item) => item.id === commandId);
    if (this.dialog?.kind === "commandPalette") this.dialog = undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    if (!command) {
      this.message = "command target changed and is no longer available";
      return;
    }
    if (!command.enabled) {
      this.message = command.disabledReason ?? "command unavailable";
      return;
    }
    if (command.id.startsWith("session:")) {
      this.selectPaletteSession(command.targetSessionId);
      return;
    }
    if (command.id.startsWith("shortcut:")) {
      this.runConfiguredCommand(command);
      return;
    }
    if (command.id.startsWith("filter:")) {
      this.executeFilterCommand(command.id);
      return;
    }
    if (command.id.startsWith("action:") && command.targetSessionId) {
      const prefix = `action:${command.targetSessionId}:`;
      const action = command.id.slice(prefix.length);
      if (action.startsWith("panel-")) {
        const slot = sidePaneSlot(action.slice("panel-".length));
        if (slot) this.openSelectedSidePane(slot);
        return;
      }
      switch (action) {
        case "open": this.attachSelected(); return;
        case "restart": this.restartSelected(); return;
        case "send": this.startSendDialog(); return;
        case "rename": this.startRenameSessionDialog(); return;
        case "sync-name": this.syncPiNameSelected(); return;
        case "fork": this.startForkDialog(); return;
        case "move-group": this.startGroupDialog(); return;
        case "rename-group": this.startRenameGroupDialog(); return;
        case "archive": this.moveSelectedToBucket("archived"); return;
        case "backlog": this.moveSelectedToBucket("backlog"); return;
        case "restore": this.restoreSelectedBucket(); return;
        case "delete": this.startDeleteDialog(); return;
        case "finish-worktree": this.startFinishDialog(); return;
        case "skills": this.startPicker("skills"); return;
        case "mcp": this.startPicker("mcp"); return;
        case "panel": this.openSelectedSidePane(); return;
        case "info": this.toggleInfo(); return;
        case "mark-read":
          this.runAction(() => this.acknowledgeSession(command.targetSessionId!), "marking read...");
          return;
        case "reorder-up": this.reorderSelected(-1); return;
        case "reorder-down": this.reorderSelected(1); return;
      }
    }
    switch (command.id) {
      case "project:skills": this.startPicker("skills"); return;
      case "project:mcp": this.startPicker("mcp"); return;
      case "action:new": this.startNewDialog(); return;
      case "view:theme": this.startThemeDialog(); return;
      case "view:density": this.toggleDensity(); return;
      case "view:grouping": this.toggleGrouping(); return;
      case "view:palette": this.openCommandPalette(); return;
      case "view:focus-panel":
        this.pendingFocusSlot = true;
        this.flashMessage("focus panel: press 1-4");
        return;
      case "view:close-panel":
        this.pendingCloseSlot = true;
        this.flashMessage("close panel: press 1-4");
        return;
      case "view:help": this.dialog = { kind: "help" }; return;
      case "view:quit": this.stop(); return;
    }
    this.message = "command is not implemented";
  }

  private runConfiguredCommand(command: DashboardCommand): void {
    const targetId = command.targetSessionId;
    const target = targetId ? this.controller.snapshot().sessions.find((session) => session.id === targetId) : undefined;
    const prefix = targetId ? `shortcut:${targetId}:` : "";
    const index = prefix && command.id.startsWith(prefix) ? Number(command.id.slice(prefix.length).split(":", 1)[0]) : -1;
    const shortcut = this.actions.dashboardShortcuts?.[index];
    if (!target || !shortcut) {
      this.message = "shortcut target is no longer available";
      return;
    }
    if (target.kind === "subagent") {
      this.message = "subagent rows cannot receive input";
      return;
    }
    if (target.status === "stopped" || target.status === "error") {
      this.message = "session is not live; press r to restart";
      return;
    }
    if (!this.actions.runDashboardShortcut) {
      this.message = "shortcut unavailable";
      return;
    }
    this.runAction(
      () => this.actions.runDashboardShortcut?.(target.id, shortcut),
      "running shortcut...",
      () => { this.flashMessage(`${shortcut.label ?? "shortcut sent"} → ${target.title}`); },
    );
  }

  private executeFilterCommand(commandId: string): void {
    if (commandId === "filter:open") {
      this.startFilter();
      return;
    }
    let filter: string | undefined;
    if (commandId === "filter:clear") filter = undefined;
    else if (commandId.startsWith("filter:lifecycle:")) filter = commandId.slice("filter:lifecycle:".length);
    else if (commandId.startsWith("filter:status:")) filter = commandId.slice("filter:status:".length);
    else if (commandId.startsWith("filter:group:")) filter = decodeURIComponent(commandId.slice("filter:group:".length));
    else {
      this.message = "filter command is not implemented";
      return;
    }
    this.revealedSessionId = undefined;
    this.controller.setFilter(filter);
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.listScrollTop = 0;
    this.actions.selectionChanged?.();
  }

  private selectPaletteSession(targetId: string | undefined): void {
    if (!targetId) {
      this.message = "session is no longer available";
      return;
    }
    const snapshot = this.controller.snapshot();
    const target = snapshot.sessions.find((session) => session.id === targetId);
    if (!target) {
      this.message = "session is no longer available";
      return;
    }
    if (!this.controller.selectSession(targetId)) {
      this.controller.setFilter(undefined);
      if (!this.controller.selectSession(targetId)) {
        this.message = "session is no longer available";
        return;
      }
    }
    const unfiltered = buildDashboardProjection({ sessions: this.controller.snapshot().sessions, grouping: this.grouping });
    const current = unfiltered.allTree.get(targetId);
    const ownerId = current ? (unfiltered.allTree.trace(current).owner ?? unfiltered.allTree.trace(current).terminal).id : targetId;
    if (this.grouping === "stage") {
      const expanded = buildDashboardProjection({ sessions: this.controller.snapshot().sessions, grouping: "stage", expandedBoardParentIds: new Set([ownerId]) });
      if (expanded.visible.some((session) => session.id === targetId)) this.expandedBoardParentIds.add(ownerId);
      else this.grouping = "project";
    }
    if (this.grouping === "project") this.expandedProjectParentIds.add(ownerId);
    this.revealedSessionId = targetId;
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.listScrollTop = 0;
    this.viewStateRevision += 1;
    this.actions.selectionChanged?.();
  }

  private startSendDialog() {
    this.openDialog(openSendPrompt);
  }

  private openSelectedSidePane(slot?: 1 | 2 | 3 | 4) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.status === "stopped" || selected.status === "error") {
      this.flashMessage("session not running");
      return;
    }
    const action = slot ? this.actions.assignSidePaneSlot : this.actions.resetSidePane;
    if (!action) {
      this.message = "side pane unavailable";
      return;
    }
    const apply = (result: SidePaneActionResult) => {
      if (result.kind === "too-narrow") this.flashMessage(`window too narrow for ${result.panels} panels`);
      else if (result.kind === "closed") this.flashMessage("panel closed");
      else this.flashMessage(slot ? `panel ${result.slot}: ${selected.title}` : `panel: ${selected.title}`);
    };
    const applyError = (error: unknown) => {
      const message = errorMessage(error);
      if (message.startsWith("side pane needs tmux")) this.flashMessage(message);
      else this.message = message;
    };
    const pending = slot ? `opening panel ${slot}...` : "resetting panels...";
    try {
      const invoke: AsyncAction<SidePaneActionResult> = slot
        ? () => this.actions.assignSidePaneSlot!(selected.id, slot)
        : () => this.actions.resetSidePane!(selected.id);
      runSyncAsyncAction(invoke, {
        pending,
        setBusy: (busy) => { this.busy = busy; },
        setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
        success: apply,
        failure: (error) => { if (this.message === pending) this.message = undefined; applyError(error); },
      });
    } catch (error) {
      applyError(error);
    }
  }

  private closeSidePane(slot: 1 | 2 | 3 | 4) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const close = this.actions.closeSidePaneSlot;
    if (!close) {
      this.message = "side pane unavailable";
      return;
    }
    const apply = (result: CloseSidePaneResult) => {
      this.flashMessage(result.kind === "closed" ? `panel ${slot} closed` : `panel ${slot} is not open`);
    };
    try {
      const pending = `closing panel ${slot}...`;
      runSyncAsyncAction(() => close(slot), {
        pending,
        setBusy: (busy) => { this.busy = busy; },
        setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
        success: apply,
        failure: (error) => { this.message = errorMessage(error); },
      });
    } catch (error) {
      this.message = errorMessage(error);
    }
  }

  private focusSidePane(slot: 1 | 2 | 3 | 4) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const focus = this.actions.focusSidePaneSlot;
    if (!focus) {
      this.message = "side pane unavailable";
      return;
    }
    const apply = (result: FocusSidePaneResult) => {
      if (result.kind === "unavailable") this.flashMessage(`panel ${slot} is not open`);
    };
    try {
      const pending = `focusing panel ${slot}...`;
      runSyncAsyncAction(() => focus(slot), {
        pending,
        setBusy: (busy) => { this.busy = busy; },
        setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
        success: apply,
        failure: (error) => { this.message = errorMessage(error); },
      });
    } catch (error) {
      this.message = errorMessage(error);
    }
  }

  private handleMouse(event: MouseEvent) {
    if (this.pendingRestart) {
      this.lastMouseClick = undefined;
      if (event.kind === "press") this.clearPendingRestart();
      return;
    }
    if (event.kind === "wheel") {
      this.lastMouseClick = undefined;
      this.moveSelection(event.delta);
      return;
    }
    const inList = event.x >= 2 && event.x <= 1 + this.listWidth;
    const target = inList ? this.rowTargets[event.y - 1] : undefined;
    if (!target) {
      this.lastMouseClick = undefined;
      return;
    }
    const previousId = this.controller.snapshot().selectedId;
    if (target.kind === "archive-disclosure") {
      this.archiveDisclosureSelected = true;
      this.selectedSection = undefined;
    } else if (target.kind === "section-header") {
      this.selectedSection = target.section;
      this.archiveDisclosureSelected = false;
    } else {
      if (target.id !== this.revealedSessionId) this.revealedSessionId = undefined;
      if (!this.controller.selectSession(target.id)) {
        this.lastMouseClick = undefined;
        return;
      }
      this.archiveDisclosureSelected = false;
      this.selectedSection = undefined;
      if (target.id !== previousId) this.actions.selectionChanged?.();
    }
    const targetKey = target.kind === "archive-disclosure" ? target.kind : target.kind === "section-header" ? `section:${target.section}` : `session:${target.id}`;
    const now = this.actions.now?.() ?? Date.now();
    const elapsed = this.lastMouseClick ? now - this.lastMouseClick.at : undefined;
    const doubleClick = this.lastMouseClick?.target === targetKey && elapsed !== undefined && elapsed >= 0 && elapsed <= DOUBLE_CLICK_MS;
    this.lastMouseClick = doubleClick ? undefined : { target: targetKey, at: now };
    if (doubleClick) {
      if (target.kind === "archive-disclosure") this.toggleArchiveDisclosure();
      else if (target.kind === "section-header") this.toggleSection(target.section);
      else this.attachSelected();
    }
  }

  private startThemeDialog() {
    this.clearPendingRestart();
    this.clearFlash();
    const result = this.actions.themeSettings?.();
    if (!result) {
      this.message = "theme settings unavailable";
      return;
    }
    if (isPromise(result)) {
      const request = ++this.themeLoadRequest;
      this.busy = true;
      this.message = "loading themes...";
      void result.then((input) => {
        if (request !== this.themeLoadRequest) return;
        this.busy = false;
        this.message = undefined;
        this.dialog = createThemeDialog(input);
      }).catch((error: unknown) => {
        if (request !== this.themeLoadRequest) return;
        this.busy = false;
        this.message = errorMessage(error);
      });
      return;
    }
    this.dialog = createThemeDialog(result);
  }

  private startPicker(mode: "skills" | "mcp") {
    this.clearPendingRestart();
    this.clearFlash();
    const selected = this.controller.selected();
    const target = this.actions.pickerTarget?.() ?? (selected
      ? { sessionId: selected.id, projectCwd: projectStateCwd(selected) }
      : { projectCwd: process.cwd() });
    const result = mode === "skills" ? this.actions.skills?.(target) : this.actions.mcpServers?.(target);
    if (!result) {
      this.message = `${mode}: no catalog loaded`;
      return;
    }
    if (isPromise<PickerItem[]>(result)) {
      this.busy = true;
      this.message = `loading ${mode}...`;
      void result.then((items) => {
        this.busy = false;
        this.setPickerDialog(mode, items, target);
      }).catch((error: unknown) => {
        this.busy = false;
        this.message = errorMessage(error);
      });
      return;
    }
    this.setPickerDialog(mode, result, target);
  }

  private setPickerDialog(mode: "skills" | "mcp", items: PickerItem[], target: { sessionId?: string; projectCwd: string }) {
    const dialog = createPickerDialog(mode, items, this.dialogContext(), target);
    if (dialog) this.dialog = dialog;
  }

  private attachSelected() {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.status === "stopped" || selected.status === "error") {
      if (this.actions.restart) this.runAction(() => this.actions.restart?.(selected.id), "starting session...");
      else this.message = `session ${selected.status}; press r twice to restart`;
      return;
    }
    if (selected.status === "waiting") {
      try {
        const result = this.acknowledgeSession(selected.id);
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

  private acknowledgeSession(sessionId: string): unknown {
    if (this.actions.acknowledgeSession) return this.actions.acknowledgeSession(sessionId);
    if (this.actions.acknowledge) return this.actions.acknowledge();
    return this.controller.acknowledgeSession(sessionId);
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

  private moveSelection(delta: number) {
    this.revealedSessionId = undefined;
    const targets = this.visibleListTargets();
    if (!targets.length) return;
    const previousId = this.controller.snapshot().selectedId;
    const index = Math.max(0, targets.findIndex((target) => target.kind === "archive-disclosure"
      ? this.archiveDisclosureSelected
      : target.kind === "section-header"
        ? this.selectedSection === target.section
        : !this.archiveDisclosureSelected && !this.selectedSection && target.id === previousId));
    const next = targets[(index + delta + targets.length) % targets.length];
    if (!next) return;
    if (next.kind === "archive-disclosure") {
      this.archiveDisclosureSelected = true;
      this.selectedSection = undefined;
    } else if (next.kind === "section-header") {
      this.archiveDisclosureSelected = false;
      this.selectedSection = next.section;
    } else {
      this.archiveDisclosureSelected = false;
      this.selectedSection = undefined;
      this.controller.selectSession(next.id);
      if (next.id !== previousId) this.actions.selectionChanged?.();
    }
  }

  private visibleListTargets(): SessionListTarget[] {
    if (this.grouping === "stage") return this.boardRows().map((row) => ({ kind: "session", id: row.id }));
    const projection = this.dashboardProjection(this.controller.snapshot());
    const { allRows, archive, visible: visibleRows, allTree: tree, filterActive } = projection;
    const sectionOf = (row: typeof allRows[number]) => effectiveSessionLifecycle(row, allRows, tree).section;
    const targets: SessionListTarget[] = visibleRows
      .filter((row) => sectionOf(row) !== "archived")
      .map((row) => ({ kind: "session" as const, id: row.id }));
    const allArchived = allRows.filter((row) => sectionOf(row) === "archived");
    if (!allArchived.length) return targets;
    const revealsArchived = Boolean(this.revealedSessionId && allArchived.some((row) => row.id === this.revealedSessionId));
    targets.push({ kind: "section-header", section: "archived" });
    if (!this.collapsedSections.has("archived") || filterActive || revealsArchived) {
      targets.push(...visibleRows.filter((row) => sectionOf(row) === "archived").map((row) => ({ kind: "session" as const, id: row.id })));
      if (archive.showDisclosure && !this.collapsedSections.has("archived")) targets.push({ kind: "archive-disclosure" });
    }
    return targets;
  }

  private normalizeListSelection() {
    const targets = this.visibleListTargets();
    if (!targets.length) {
      this.archiveDisclosureSelected = false;
      this.selectedSection = undefined;
      return;
    }
    if (this.archiveDisclosureSelected) {
      if (targets.some((target) => target.kind === "archive-disclosure")) return;
      this.archiveDisclosureSelected = false;
    }
    if (this.selectedSection && targets.some((target) => target.kind === "section-header" && target.section === this.selectedSection)) return;
    this.selectedSection = undefined;
    const selectedId = this.controller.snapshot().selectedId;
    if (targets.some((target) => target.kind === "session" && target.id === selectedId)) return;
    const snapshot = this.controller.snapshot();
    const projection = this.dashboardProjection(snapshot, undefined);
    const { allRows, allTree: tree } = projection;
    const selectedRow = allRows.find((row) => row.id === selectedId);
    if (selectedRow && !snapshot.filter?.trim()) {
      const section = effectiveSessionLifecycle(selectedRow, allRows, tree).section;
      if (section === "archived" && this.collapsedSections.has("archived")) {
        this.selectedSection = "archived";
        return;
      }
    }
    const boardParentId = this.topLevelBoardParentId(selectedId);
    if (boardParentId && targets.some((target) => target.kind === "session" && target.id === boardParentId)) {
      if (this.controller.selectSession(boardParentId) && boardParentId !== selectedId) this.actions.selectionChanged?.();
      return;
    }
    const fallback = [...targets].reverse().find((target): target is Extract<SessionListTarget, { kind: "session" }> => target.kind === "session");
    if (fallback && this.controller.selectSession(fallback.id) && fallback.id !== selectedId) this.actions.selectionChanged?.();
  }

  private toggleArchiveDisclosure() {
    this.revealedSessionId = undefined;
    this.archiveExpanded = !this.archiveExpanded;
    this.viewStateRevision += 1;
    this.normalizeListSelection();
  }

  private toggleSection(section: CollapsibleSection) {
    this.revealedSessionId = undefined;
    if (this.collapsedSections.has(section)) this.collapsedSections.delete(section);
    else this.collapsedSections.add(section);
    this.viewStateRevision += 1;
    this.saveViewState();
    this.normalizeListSelection();
  }

  private boardRows() {
    return this.dashboardProjection(this.controller.snapshot()).boardProjection.rows;
  }

  private dashboardProjection(snapshot: ReturnType<SessionsController["snapshot"]>, filterOverride?: string): DashboardProjection {
    const filter = filterOverride === undefined ? snapshot.filter?.trim() || undefined : filterOverride;
    const key = `${this.grouping}|${this.archiveExpanded}|${snapshot.sessions.length}|${this.viewStateRevision}|${filter ?? ""}|${this.revealedSessionId ?? ""}|${[...this.collapsedSections].join(",")}|${[...this.expandedBoardParentIds].join(",")}|${[...this.expandedProjectParentIds].join(",")}`;
    if (this.projection && this.projectionRegistry === snapshot.registry && this.projectionKey === key) return this.projection;
    this.projection = buildDashboardProjection({ sessions: snapshot.sessions, filter, grouping: this.grouping,
      archiveExpanded: this.archiveExpanded, collapsedSections: this.collapsedSections,
      expandedBoardParentIds: this.expandedBoardParentIds, expandedProjectParentIds: this.expandedProjectParentIds,
      revealedSessionId: this.revealedSessionId });
    this.projectionRegistry = snapshot.registry;
    this.projectionKey = key;
    return this.projection;
  }

  private topLevelBoardParentId(sessionId: string | undefined): string | undefined {
    if (!sessionId) return undefined;
    const projection = this.dashboardProjection(this.controller.snapshot(), undefined);
    const session = projection.allTree.get(sessionId);
    return session ? projection.allTree.trace(session).owner?.id : undefined;
  }

  private subagentParentIds(): Set<string> {
    const projection = this.dashboardProjection(this.controller.snapshot(), undefined);
    const rows = projection.allRows;
    const tree = projection.allTree;
    const scopedRows = this.grouping === "stage" ? projection.activeRows : rows;
    const scopedIds = new Set(scopedRows.map((session) => session.id));
    const parentIds = new Set<string>();
    for (const session of scopedRows) {
      if (session.kind !== "subagent") continue;
      const owner = tree.trace(session).owner;
      if (owner && owner.kind !== "subagent" && scopedIds.has(owner.id)) parentIds.add(owner.id);
    }
    return parentIds;
  }

  private setSelectedSubagents(expanded: boolean) {
    this.revealedSessionId = undefined;
    const selectedId = this.controller.snapshot().selectedId;
    const parentId = this.topLevelBoardParentId(selectedId);
    if (!parentId || !this.subagentParentIds().has(parentId)) return;
    const expandedIds = this.grouping === "stage" ? this.expandedBoardParentIds : this.expandedProjectParentIds;
    if (expanded) expandedIds.add(parentId);
    else expandedIds.delete(parentId);
    this.viewStateRevision += 1;
    if (!expanded && selectedId !== parentId && this.controller.selectSession(parentId)) this.actions.selectionChanged?.();
    this.listScrollTop = 0;
  }

  private setAllSubagents(expanded: boolean) {
    this.revealedSessionId = undefined;
    const expandedIds = this.grouping === "stage" ? this.expandedBoardParentIds : this.expandedProjectParentIds;
    if (expanded) {
      for (const parentId of this.subagentParentIds()) expandedIds.add(parentId);
    } else expandedIds.clear();
    this.viewStateRevision += 1;
    if (!expanded) {
      const selectedId = this.controller.snapshot().selectedId;
      const parentId = this.topLevelBoardParentId(selectedId);
      if (parentId && selectedId !== parentId && this.controller.selectSession(parentId)) this.actions.selectionChanged?.();
    }
    this.listScrollTop = 0;
  }

  private toggleBoardSubagents() {
    const parentId = this.topLevelBoardParentId(this.controller.snapshot().selectedId);
    if (!parentId || !this.subagentParentIds().has(parentId)) return;
    this.setSelectedSubagents(!this.expandedBoardParentIds.has(parentId));
  }

  private saveViewState() {
    const state: SessionsViewState = { grouping: this.grouping, density: this.density };
    if (this.collapsedSections.size) state.collapsedSections = [...this.collapsedSections];
    this.actions.saveViewState?.(state);
  }

  private toggleDensity() {
    this.revealedSessionId = undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.density = this.density === "compact" ? "all-cards" : "compact";
    this.saveViewState();
  }

  private toggleGrouping() {
    this.revealedSessionId = undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.grouping = this.grouping === "project" ? "stage" : "project";
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.saveViewState();
    const previousId = this.controller.snapshot().selectedId;
    if (this.grouping !== "stage") {
      this.normalizeListSelection();
      return;
    }
    const rows = this.boardRows();
    if (rows.length && !rows.some((row) => row.id === previousId)) {
      const parentId = this.topLevelBoardParentId(previousId);
      const nextId = rows.find((row) => row.id === parentId)?.id ?? rows[0]?.id ?? "";
      this.controller.selectSession(nextId);
      if (this.controller.snapshot().selectedId !== previousId) this.actions.selectionChanged?.();
    }
  }

  private reorderSelected(delta: -1 | 1) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    if (this.grouping === "stage") {
      this.message = "switch to project grouping to reorder";
      return;
    }
    if (this.controller.snapshot().filter !== undefined) {
      this.message = "clear filter to reorder";
      return;
    }
    if (this.controller.selected()?.kind === "subagent") {
      this.message = "subagent rows follow their parent order";
      return;
    }
    if (this.controller.selected()?.bucket === "archived") {
      this.message = "Archived is sorted by archive time";
      return;
    }
    const selected = this.controller.selected();
    if (!selected) return;
    this.runAction(
      () => this.actions.reorderSession
        ? this.actions.reorderSession(selected.id, delta)
        : this.actions.reorderSelected
          ? this.actions.reorderSelected(delta)
          : this.controller.reorderSession(selected.id, delta),
      "reordering session...",
    );
  }

  private moveSelectedToBucket(bucket: "backlog" | "archived") {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows follow their parent section";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    const action = bucket === "archived" ? this.actions.archiveSession : this.actions.backlogSession;
    this.runAction(() => action ? action(selected.id) : this.controller.moveSessionToBucket(selected.id, bucket), bucket === "archived" ? "archiving session..." : "moving to backlog...");
  }

  private restoreSelectedBucket() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows follow their parent section";
      return;
    }
    if (!selected.bucket) {
      this.message = "session already active";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.runAction(() => this.actions.restoreSession ? this.actions.restoreSession(selected.id) : this.controller.restoreSessionBucket(selected.id), "restoring session...");
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
    this.pendingRestart = { sessionId: selected.id };
    this.message = undefined;
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

  private confirmRestartAll() {
    if (!this.pendingRestart) return;
    this.pendingRestart = undefined;
    this.message = undefined;
    if (!this.actions.restartAll) {
      this.message = "restart all unavailable";
      return;
    }
    this.runAction(() => this.actions.restartAll?.(), "restarting active sessions...");
  }

  private startDeleteDialog() {
    this.openDialog(openDeleteDialog);
  }

  private startFinishDialog() {
    this.openDialog(openFinishDialog);
  }

  private clearPendingRestart() {
    const hadPendingRestart = Boolean(this.pendingRestart);
    this.pendingRestart = undefined;
    this.clearPendingFocusSlot();
    if (hadPendingRestart) this.message = undefined;
  }

  private clearPendingFocusSlot() {
    if (!this.pendingFocusSlot && !this.pendingCloseSlot) return;
    this.pendingFocusSlot = false;
    this.pendingCloseSlot = false;
    this.clearFlash();
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

}

function overlayCommandPalette(
  baseLines: string[],
  state: CommandPaletteState,
  commands: readonly DashboardCommand[],
  width: number,
  theme?: SessionsTheme,
): { lines: string[]; rowTargets: (CommandPaletteRowTarget | undefined)[]; bounds?: { start: number; end: number } } {
  const lines = baseLines.slice();
  const rowTargets = lines.map(() => undefined as CommandPaletteRowTarget | undefined);
  if (lines.length < 4) return { lines, rowTargets };
  const footerIndex = lines.length - 2;
  const available = Math.max(0, footerIndex - 1);
  const preferred = width <= 60 ? 30 : 26;
  const panelHeight = Math.min(preferred, available);
  if (panelHeight < 3) return { lines, rowTargets };
  const innerWidth = Math.max(1, width - 2);
  const palette = renderCommandPalette(state, commands, innerWidth, panelHeight, theme);
  const start = footerIndex - panelHeight;
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  for (let index = 0; index < panelHeight; index += 1) {
    const panelLine = palette.lines[index] ?? "";
    const padded = `${panelLine}${" ".repeat(Math.max(0, innerWidth - visibleWidth(panelLine)))}`;
    lines[start + index] = `${border("│")}${padded}${border("│")}`;
    rowTargets[start + index] = palette.rowTargets[index];
  }
  return { lines, rowTargets, bounds: { start, end: start + panelHeight - 1 } };
}

function sidePaneSlot(data: string): 1 | 2 | 3 | 4 | undefined {
  if (data === "1" || data === "2" || data === "3" || data === "4") return Number(data) as 1 | 2 | 3 | 4;
  return undefined;
}

function syncPiNameMessage(result: SyncPiNameResult): string {
  switch (result.status) {
    case "synced": return `renamed from Pi name: ${result.name}`;
    case "unavailable": return "Pi session file not available yet";
    case "unnamed": return "no Pi name set";
  }
}

function renderHelp(width: number, theme: SessionsTheme | undefined, commands: readonly DashboardCommand[]): string[] {
  const heading = (text: string) => theme ? styleToken(theme, "accent", text) : text;
  const commandLines = commands
    .filter((command) => command.group !== "sessions")
    .map((command) => {
      const keys = command.bindings.map((binding) => binding.key).join("/") || ":";
      const unavailable = command.enabled ? "" : ` · unavailable: ${command.disabledReason}`;
      return `  ${padVisibleLine(keys, 12)} ${command.label} · ${command.hint}${unavailable}`;
    });
  const lines = [
    heading("pi agent hub help"),
    "",
    heading("Commands"),
    ...commandLines,
    "",
    heading("Navigation"),
    "  ↑↓/j/k move selection     Esc cancel/clear",
    "  1-4 assign (stay here)    x then 1-4 close panel",
    "  F then 1-4 or Alt+1-4 focus panel",
    "  subagent trees: ←/→ collapse/expand selected · Shift+←/→ all",
    "  mouse click select · double-click open/switch · wheel move",
    "",
    heading("Choice dialogs"),
    "  Restart: r selected     n new conversation     a all     Esc cancel",
    "  Delete: d delete/forget     D discard worktree     s close subagents     w finish worktree",
    "  Group picker: Ctrl+N/P cycles groups",
    "",
    heading("New-session form"),
    "  Tab/↑↓ move     Space toggles Worktree row     Ctrl+T toggles anywhere     Ctrl+O choose repo",
    "  Alt+A add repo     Alt+X remove extra",
    "",
    heading("Pickers and themes"),
    "  pickers: ←→/Tab switch columns; theme: live preview, Enter apply, Esc cancel",
    "",
    heading("Return from managed sessions and panels"),
    "  Alt+Q panel to sidebar     Ctrl+Q return fallback     Alt+R rename session",
    "",
    heading("Sections and views"),
    "  Project view: Needs you · Health · Active · Quiet; groups appear on session rows",
    "  only explicit producer attention enters Needs you; Backlog stays labeled in Quiet when inactive",
    "  Archived is flat and chronological; Enter/double-click reveals older rows",
    "  Archived cascades auto-remove after 7d once every tmux session is gone",
    "  v temporarily cycles row density; S temporarily toggles the producer workflow board",
    "  Board view lanes canonical workflow sessions by producer step, then OTHER ACTIVE;",
    "  subagent trees start collapsed; Space toggles one board tree; filters reveal matches",
    "  every lane nests project/group labels; Backlog/Archived stay summarized",
    "",
    heading("Status legend"),
    "  ● running/starting     ◐ waiting     ○ idle     × error     - stopped",
    "  zero counts are hidden from tier and top summaries",
    "",
    heading("Metadata"),
    "  i toggle compact/full selected-session info; full info explains runtime and cockpit status",
    "  below 80 columns, i opens a full-width status explanation; i/Esc returns",
  ];
  const inner = Math.max(40, width) - 2;
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  return [
    border(`╭${"─".repeat(inner)}╮`),
    ...lines.map((line) => `${border("│")}${padVisibleLine(line, inner)}${border("│")}`),
    border(`╰${"─".repeat(inner)}╯`),
  ];
}

function padVisibleLine(line: string, width: number): string {
  const text = truncateVisible(line, width);
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function limitRows(lines: string[], height: number | undefined, width: number, theme?: SessionsTheme): string[] {
  if (!height || height <= 0 || lines.length <= height) return lines;
  const marker = theme ? styleToken(theme, "dim", "… resize for full help") : "… resize for full help";
  return [...lines.slice(0, Math.max(0, height - 1)), truncateVisible(marker, Math.max(1, width))];
}

function narrowNotice(width: number): string[] {
  const safeWidth = Math.max(1, width);
  return [
    "pi agent hub",
    "pane too narrow",
    `widen to ≥${MIN_RENDER_WIDTH} cols`,
  ].map((line) => truncateVisible(line, safeWidth));
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
