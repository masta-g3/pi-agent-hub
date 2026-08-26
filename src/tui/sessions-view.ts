import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { attachPlan } from "../app/actions.js";
import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import type { ManagedSession } from "../core/types.js";
import { matchesDashboardShortcut } from "./dashboard-shortcuts.js";
import { effectiveSessionLifecycle } from "./archive-section.js";
import { buildDashboardProjection, buildRenderModel, type DashboardProjection } from "./render-model.js";
import { renderSessions, type SessionListTarget } from "./layout.js";
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
  private listWidth = 0;
  private listScrollTop = 0;
  private expandedBoardParentIds = new Set<string>();
  private expandedProjectParentIds = new Set<string>();
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
    if (isMouseSequence(data)) {
      this.clearPendingFocusSlot();
      const event = parseMouseEvent(data);
      if (event && !this.dialog && !this.busy) this.handleMouse(event);
      else if (event) this.lastMouseClick = undefined;
      return;
    }

    this.lastMouseClick = undefined;
    if (this.dialog) {
      if (this.dialog.kind === "help") {
        if (data === "q") this.stop();
        else if (matchesKey(data, Key.escape) || data === "?") this.dialog = undefined;
      } else if (this.dialog.kind === "prompt") this.dialog = handlePromptInput(this.dialog, data, this.dialogContext());
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
    if (data === "t") {
      this.startThemeDialog();
      return;
    }
    if (this.grouping === "stage" && !this.boardRows().length) {
      if (matchesKey(data, Key.slash)) this.startFilter();
      else if (data === "n") this.startNewDialog();
      else if (data === "v") this.toggleDensity();
      else if (data === "S") this.toggleGrouping();
      else if (data === "?") this.dialog = { kind: "help" };
      else if (data === "q") this.stop();
      return;
    }
    if (data === "F") {
      this.clearPendingRestart();
      this.clearFlash();
      this.message = undefined;
      this.pendingFocusSlot = true;
      this.flashMessage("focus panel: press 1-4");
      return;
    }
    if (data === "x") {
      this.clearPendingRestart();
      this.clearFlash();
      this.message = undefined;
      this.pendingCloseSlot = true;
      this.flashMessage("close panel: press 1-4");
      return;
    }

    if (this.archiveDisclosureSelected || this.selectedSection) {
      if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
      else if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
      else if (isEnterKey(data)) this.selectedSection ? this.toggleSection(this.selectedSection) : this.toggleArchiveDisclosure();
      else if (matchesKey(data, Key.slash)) this.startFilter();
      else if (data === "n") this.startNewDialog();
      else if (data === "i") this.detailsExpanded = !this.detailsExpanded;
      else if (data === "v") this.toggleDensity();
      else if (data === "S") this.toggleGrouping();
      else if (data === "?") this.dialog = { kind: "help" };
      else if (data === "q") this.stop();
      return;
    }

    const panelSlot = sidePaneSlot(data);
    if (panelSlot) {
      this.openSelectedSidePane(panelSlot);
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
    if (this.runConfiguredShortcut(data)) return;

    if (data === "J" || matchesKey(data, Key.shift("down"))) this.reorderSelected(1);
    else if (data === "K" || matchesKey(data, Key.shift("up"))) this.reorderSelected(-1);
    else if (data === "N" || matchesKey(data, Key.alt("n"))) this.syncPiNameSelected();
    else if (matchesKey(data, Key.down) || data === "j") {
      this.clearPendingRestart();
      this.moveSelection(1);
    }
    else if (matchesKey(data, Key.up) || data === "k") {
      this.clearPendingRestart();
      this.moveSelection(-1);
    }
    else if (isEnterKey(data)) this.attachSelected();
    else if (matchesKey(data, Key.slash)) this.startFilter();
    else if (data === "n") this.startNewDialog();
    else if (data === "f") this.startForkDialog();
    else if (data === "g") this.startGroupDialog();
    else if (data === "A") this.moveSelectedToBucket("archived");
    else if (data === "B") this.moveSelectedToBucket("backlog");
    else if (data === "U") this.restoreSelectedBucket();
    else if (data === "e" || data === "R") this.startRenameSessionDialog();
    else if (data === "G") this.startRenameGroupDialog();
    else if (data === "o") this.openSelectedSidePane();
    else if (data === "p") this.startSendDialog();
    else if (data === "r") this.restartSelected();
    else if (data === "d") this.startDeleteDialog();
    else if (data === "w") this.startFinishDialog();
    else if (data === "s") this.startPicker("skills");
    else if (data === "m") this.startPicker("mcp");
    else if (data === "i") {
      this.clearPendingRestart();
      this.clearFlash();
      this.detailsExpanded = !this.detailsExpanded;
    }
    else if (data === "v") this.toggleDensity();
    else if (data === "S") this.toggleGrouping();
    else if (data === "a") {
      this.clearPendingRestart();
      this.clearFlash();
      this.runAction(() => this.actions.acknowledge ? this.actions.acknowledge() : this.controller.acknowledgeSelected(), "marking read...");
    }
    else if (data === "?") {
      this.clearPendingRestart();
      this.clearFlash();
      this.dialog = { kind: "help" };
    }
    else if (data === "q") this.stop();
  }

  render(width: number): string[] {
    this.clearExpiredFlash();
    const height = this.actions.terminalRows?.() ?? process.stdout.rows;
    if (width < MIN_RENDER_WIDTH) {
      this.rowTargets = [];
      this.listWidth = 0;
      return narrowNotice(width);
    }
    if (this.dialog?.kind === "help") return limitRows(renderHelp(width, this.theme), height, width, this.theme);
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
    const layout = renderSessions(buildRenderModel({
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
      structuralProjection,
    }), this.theme);
    this.rowTargets = layout.rowTargets;
    this.listWidth = layout.listWidth;
    this.listScrollTop = layout.listScrollTop;
    const footer = this.dialog?.kind === "prompt" ? promptFooter(this.dialog, this.dialogContext()) : undefined;
    const withFooter = footer ? replaceFooter(layout.lines, footer, this.theme) : layout.lines;
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
    const previousId = this.controller.snapshot().selectedId;
    this.controller.setFilter(undefined);
    if (!this.controller.selectSession(target.id)) return false;
    if (target.id !== previousId) this.actions.selectionChanged?.();
    this.startRenameSessionDialog(tmuxSession);
    return this.dialog?.kind === "form" && this.dialog.purpose === "renameSession";
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

  private runConfiguredShortcut(data: string): boolean {
    const shortcut = this.actions.dashboardShortcuts?.find((item) => matchesDashboardShortcut(data, item.key));
    if (!shortcut) return false;
    const selected = this.controller.selected();
    if (!selected) return true;
    if (selected.kind === "subagent") {
      this.message = "subagent rows cannot receive input";
      return true;
    }
    if (selected.status === "stopped" || selected.status === "error") {
      this.message = "session is not live; press r to restart";
      return true;
    }
    if (!this.actions.runDashboardShortcut) {
      this.message = "shortcut unavailable";
      return true;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.runAction(
      () => this.actions.runDashboardShortcut?.(selected.id, shortcut),
      "running shortcut...",
      () => { this.flashMessage(`${shortcut.label ?? "shortcut sent"} → ${selected.title}`); },
    );
    return true;
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
        this.setPickerDialog(mode, items);
      }).catch((error: unknown) => {
        this.busy = false;
        this.message = errorMessage(error);
      });
      return;
    }
    this.setPickerDialog(mode, result);
  }

  private setPickerDialog(mode: "skills" | "mcp", items: PickerItem[]) {
    const dialog = createPickerDialog(mode, items, this.dialogContext());
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

  private moveSelection(delta: number) {
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
    targets.push({ kind: "section-header", section: "archived" });
    if (!this.collapsedSections.has("archived") || filterActive) {
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
    this.archiveExpanded = !this.archiveExpanded;
    this.viewStateRevision += 1;
    this.normalizeListSelection();
  }

  private toggleSection(section: CollapsibleSection) {
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
    const key = `${this.grouping}|${this.archiveExpanded}|${snapshot.sessions.length}|${this.viewStateRevision}|${filter ?? ""}|${[...this.collapsedSections].join(",")}|${[...this.expandedBoardParentIds].join(",")}|${[...this.expandedProjectParentIds].join(",")}`;
    if (this.projection && this.projectionRegistry === snapshot.registry && this.projectionKey === key) return this.projection;
    this.projection = buildDashboardProjection({ sessions: snapshot.sessions, filter, grouping: this.grouping,
      archiveExpanded: this.archiveExpanded, collapsedSections: this.collapsedSections,
      expandedBoardParentIds: this.expandedBoardParentIds, expandedProjectParentIds: this.expandedProjectParentIds });
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
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.density = this.density === "compact" ? "all-cards" : "compact";
    this.saveViewState();
  }

  private toggleGrouping() {
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
    const reorder = this.actions.reorderSelected;
    this.runAction(() => reorder ? reorder(delta) : this.controller.reorderSelected(delta), "reordering session...");
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

function renderHelp(width: number, theme?: SessionsTheme): string[] {
  const heading = (text: string) => theme ? styleToken(theme, "accent", text) : text;
  const lines = [
    heading("pi agent hub help"),
    "",
    heading("Navigation"),
    "  ↑↓/j/k move selection     Enter open/switch     / filter",
    "  1-4 assign (stay here)    x then 1-4 close panel",
    "  F then 1-4 or Alt+1-4 focus panel     o reset to one panel",
    "  q quit                     Esc cancel/clear",
    "  K/J reorder in group      v cycle row density",
    "  S toggle project/stage grouping",
    "  subagent trees: ←/→ collapse/expand selected · Shift+←/→ all",
    "  mouse click select · double-click open/switch · wheel move",
    "",
    heading("Sessions"),
    "  n new     p send     r restart choices     N sync Pi name     f fork     w finish worktree",
    "  R rename     g move group (Ctrl+N/P cycles groups)     G rename group     d delete     a mark read",
    "  A archive     B backlog     U restore to Active",
    "  Restart choices: r selected     n new conversation     a all     Esc cancel",
    "  Delete choices: d delete/forget     D discard worktree     s close subagents     w finish worktree",
    "",
    heading("New-session form"),
    "  Tab/↑↓ move     Space toggles Worktree row     Ctrl+T toggles anywhere     Ctrl+O choose repo",
    "  Alt+A add repo     Alt+X remove extra",
    "",
    heading("Project state"),
    "  s skills picker     m MCP picker     t theme settings",
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
    "  i toggle compact/full selected-session info",
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
  return `${text}${" ".repeat(Math.max(0, width - stripAnsi(text).length))}`;
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
