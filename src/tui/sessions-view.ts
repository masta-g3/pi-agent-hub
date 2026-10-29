import { glyphs } from "./glyphs.js";
import { ConversationReader, renderConversationHeading, renderConversationPane, SelectedInteractionObserver } from "./conversation.js";
import { DELIVERY_UNCONFIRMED, INTERACTION_TIMEOUT_MS, sameInteractionTarget, type InteractionTarget, type MessageDelivery } from "../core/session-interaction.js";
import { createQuestionDialog, handleQuestionInput, renderQuestionDialog, type QuestionDialog } from "./question-dialog.js";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { attachPlan } from "../app/actions.js";
import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import type { ManagedSession, RuntimeSession } from "../core/types.js";
import { projectStateCwd } from "../core/multi-repo.js";
import { dashboardFilterState, parseDashboardFilter, serializeDashboardFilter } from "../core/dashboard-filter.js";
import { formatKey } from "./dashboard-shortcuts.js";
import type { DashboardShortcut } from "../core/dashboard-shortcuts.js";
import { effectiveSessionLifecycle } from "./archive-section.js";
import { buildDashboardCommands, commandForKey, dashboardHelpSections, selectWorkspaceCommands, type DashboardCommand, type DashboardCommandCapabilities } from "./dashboard-commands.js";
import {
  createCommandPalette,
  handleCommandPaletteInput,
  handleCommandPaletteMouse,
  normalizeCommandPalette,
  renderCommandPalette,
  type CommandPaletteDetailRegion,
  type CommandPaletteTargetIdentity,
  type CommandPaletteRowTarget,
  type CommandPaletteState,
} from "./command-palette-dialog.js";
import { alwaysExpanded, buildDashboardProjection, buildRenderModel, needsYouOwners, visibleAttention, type AttentionAnnouncement, type CockpitTier, type DashboardProjection, type FilterDisclosure, type RenderCardPanel } from "./render-model.js";
import { MIN_LAYOUT_WIDTH, NARROW_LAYOUT_MAX_WIDTH, renderSessions, wrapWords, type PanelViewport, type CardCommandHit, type FooterItem, type SessionListTarget, type TierChip } from "./layout.js";
import { isMouseSequence, parseMouseEvent, type MouseEvent } from "./mouse.js";
import { DOWN, PAGE_DOWN, PAGE_UP, UP, hitAt, type DialogHit } from "./dialog-mouse.js";
import { noColor, stripAnsi, styleToken, type SessionsTheme } from "./theme.js";
import type { PickerItem } from "./two-column-picker.js";
import type { FollowSidePaneResult } from "../app/side-pane.js";
import type { CollapsibleSection, SessionsViewState } from "./dialog.js";
import { errorMessage, isPromise, type CloseSidePaneResult, type DialogContext, type ResizeSidePaneResult, type SessionDialog, type SessionsViewActions, type SidePaneResult, type SidePaneViewState } from "./dialog.js";

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
import { handlePromptInput, openFilterPrompt, promptFilterValue } from "./prompt-dialog.js";
import { createTextInput, editTextInput, isEnterKey, type TextInputState } from "./text-input.js";
import { handleFormDialogInput, openForkCompactDialog, openForkDialog, openMoveGroupDialog, openRenameGroupDialog, openRenameSessionForm, renderFormDialog } from "./form-dialogs.js";
import { createRestartDialog, handleArchiveInput, handleRestartDialogInput, handleConfirmInput, openArchiveDialog, openDeleteDialog, openFinishDialog, renderArchiveDialog, renderConfirmDialog, renderRestartDialog, type ConfirmationReview, type RestartDialog } from "./confirm-dialogs.js";
import { createPickerDialog, handlePickerDialogInput, renderPickerDialog } from "./picker-dialog.js";
import { handleNewSessionInput, openNewSessionDialog, renderNewSessionDialog } from "./new-session-dialog.js";
import { handleFavoritesInput, renderFavoritesDialog } from "./session-favorites-dialog.js";
import { createThemeDialog, handleThemeDialogInput, renderThemeDialog } from "./theme-dialog.js";
import { completeAttentionTrip, COCKPIT_RELEASE_CUE, releaseCueVisible, startAttentionTrip, type CockpitOnboardingState } from "./cockpit-onboarding.js";

const MIN_RENDER_WIDTH = MIN_LAYOUT_WIDTH;
const DOUBLE_CLICK_MS = 400;
/** Follow view waits for the selection to settle so held j/k does not retarget per row. */
const FOLLOW_SETTLE_MS = 200;

interface ReplyDraft {
  target: InteractionTarget;
  input: TextInputState;
  delivery: MessageDelivery;
  deliveryFocus: boolean;
  submitting?: boolean;
}

export class SessionsView implements Component {
  private replyDrafts = new Map<string, ReplyDraft>();
  private replyEditor: ReplyDraft | undefined;
  private deliveryResults = new Map<string, { target: InteractionTarget; state: "submitting" | "accepted" | "rejected" | "unknown"; text: string; status: RuntimeSession["status"] }>();
  private cardPanel: { target: InteractionTarget; panel: RenderCardPanel; handleInput: (data: string) => void } | undefined;
  private panelViewport: PanelViewport = { pageSize: 1, maxOffset: 0 };
  private conversationOpen = false;
  private conversationGeneration = 0;
  private interactionStopped = false;
  private conversationFocus: string = "fleet";
  private inlineQuestion: QuestionDialog | undefined;
  private conversationReader = new ConversationReader();
  private interaction = new SelectedInteractionObserver();
  private conversationActions: DashboardCommand[] = [];
  private conversationActionRows: (string | undefined)[] = [];
  private conversationStartY = 1;
  private conversationTranscriptEndY = 1;
  private olderConversationRequested = false;
  private dialog: SessionDialog | undefined;
  private helpScroll = 0;
  private helpPageSize = 1;
  private helpMaxScroll = 0;
  private message: string | undefined;
  private flash: { text: string; expiresAt: number } | undefined;
  private workspaceSessionId: string | undefined;
  private workspaceEvidenceSessionId: string | undefined;
  private cardScrollOffset = 0;
  private cardScrollSessionId: string | undefined;
  private lastWidth = 120;
  private grouping: "project" | "stage";
  private fleetGrouping: "status" | "repo";
  private pendingRestart: RestartDialog | undefined;
  private confirmationReview: ConfirmationReview | undefined;
  private lastMouseClick: { target: string; at: number } | undefined;
  /** Hits from the last dialog render; they apply only while `dialogHitOwner` is still the open dialog. */
  private dialogHits: DialogHit[] = [];
  private dialogHitOwner: unknown;
  private busy = false;
  private archiveExpanded = false;
  private archiveDisclosureSelected = false;
  private initialSelectionPending = true;
  private selectedSection: CollapsibleSection | undefined;
  private filterDisclosure: FilterDisclosure = { sections: new Set(), repos: new Set(), projectTrees: new Set(), boardTrees: new Set() };
  private collapsedSections = new Set<CollapsibleSection>();
  private collapsedRepos = new Set<string>();
  private selectedRepo: string | undefined;
  private rowTargets: (SessionListTarget | undefined)[] = [];
  private selectedRowAnimating = false;
  private followTarget: string | undefined;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  /** Follow view should reopen on the live selection after its pane closes; `o` and the saved default set it. */
  private followWanted: boolean;
  private followRefused: string | undefined;
  private tierChipRow: number | undefined;
  private tierChips: TierChip[] = [];
  private workspaceRowTargets: (string | undefined)[] = [];
  private cardCommandHits: CardCommandHit[] = [];
  private announcementRowTargets: (string | undefined)[] = [];
  private attentionAnnouncements: readonly AttentionAnnouncement[] = [];
  private listStartX = 2;
  private workspaceStartX: number | undefined;
  private footerRow: number | undefined;
  private footerItems: FooterItem[] = [];
  private paletteRowTargets: (CommandPaletteRowTarget | undefined)[] = [];
  private paletteBounds: { start: number; end: number } | undefined;
  private paletteDetailRegion: CommandPaletteDetailRegion | undefined;
  private listWidth = 0;
  private listScrollTop = 0;
  private expandedBoardParentIds = new Set<string>();
  private expandedProjectParentIds = new Set<string>();
  private revealedSessionId: string | undefined;
  private themeLoadRequest = 0;
  private themeLoading = false;
  private projection?: DashboardProjection;
  private projectionRegistry?: object;
  private projectionKey = "";
  private viewStateRevision = 0;
  private cockpitOnboarding: CockpitOnboardingState | undefined;
  private dismissedReleaseCueId: string | undefined;
  private releaseCueSelected = false;
  private releaseCueEnabled: boolean;

  constructor(private controller: SessionsController, private stop: () => void, private actions: SessionsViewActions = {}, private theme?: SessionsTheme) {
    this.grouping = actions.initialViewState?.grouping ?? "project";
    this.fleetGrouping = actions.initialViewState?.fleetGrouping ?? "status";
    this.collapsedSections = new Set(actions.initialViewState?.collapsedSections ?? []);
    const restoredFilter = actions.initialViewState?.filter;
    if (restoredFilter) {
      const filter = serializeDashboardFilter({ lifecycle: new Set(restoredFilter.lifecycle), ...(restoredFilter.text ? { text: restoredFilter.text } : {}) });
      controller.setFilter(filter);
    }
    this.cockpitOnboarding = actions.initialViewState?.cockpitOnboarding;
    this.dismissedReleaseCueId = actions.initialViewState?.dismissedReleaseCueId;
    this.releaseCueEnabled = actions.initialViewState !== undefined;
    this.followWanted = actions.followPreference?.followDefault() ?? false;
  }

  /** Reply and answer surfaces use this shell instead of adding a modal or renderer. */
  setCardPanel(target: InteractionTarget, panel: RenderCardPanel, handleInput: (data: string) => void): void {
    this.replyEditor = undefined;
    this.cardPanel = { target, panel, handleInput };
    this.panelViewport = { pageSize: 1, maxOffset: 0 };
    this.actions.requestRender?.();
  }

  clearCardPanel(): void {
    this.replyEditor = undefined;
    this.cardPanel = undefined;
    this.actions.requestRender?.();
  }

  setTheme(theme: SessionsTheme): void {
    this.theme = theme;
  }

  setMessage(message: string | undefined): void {
    this.message = message;
  }

  setAttentionAnnouncements(announcements: readonly AttentionAnnouncement[]): void {
    this.attentionAnnouncements = announcements.map((announcement) => ({ ...announcement }));
  }

  handleInput(data: string): void {
    if (this.grouping !== "stage") this.workspaceSessionId = undefined;
    if (this.workspaceSessionId && this.controller.selected()?.id !== this.workspaceSessionId) this.closeWorkspace();
    if (this.workspaceSessionId && this.pinMode()) this.closeWorkspace();
    if (isMouseSequence(data)) {
      const event = parseMouseEvent(data);
      if (event && this.conversationOpen && !this.dialog && !this.busy && this.handleConversationMouse(event)) return;
      else if (event && this.dialog?.kind === "help" && event.kind === "wheel") this.helpScroll = Math.max(0, Math.min(this.helpMaxScroll, this.helpScroll + event.delta * 3));
      else if (event && this.dialog?.kind === "commandPalette" && !this.busy) this.handlePaletteMouse(event);
      else if (event && (this.dialog || this.pendingRestart) && !this.busy && this.handleDialogMouse(event)) return;
      else if (event && !this.dialog && !this.busy) this.handleFleetMouse(event);
      else if (event) this.lastMouseClick = undefined;
      return;
    }

    this.lastMouseClick = undefined;
    if (this.dialog && this.dialogNeedsRoom() && !matchesKey(data, Key.escape)) return;
    if (this.dialog) {
      if (this.dialog.kind === "help") {
        if (data === "q") this.stop();
        else if (matchesKey(data, Key.escape) || data === "?") this.dialog = undefined;
        else if (matchesKey(data, Key.down) || matchesKey(data, Key.pageDown)) this.helpScroll = Math.min(this.helpMaxScroll, this.helpScroll + (matchesKey(data, Key.pageDown) ? this.helpPageSize : 1));
        else if (matchesKey(data, Key.up) || matchesKey(data, Key.pageUp)) this.helpScroll = Math.max(0, this.helpScroll - (matchesKey(data, Key.pageUp) ? this.helpPageSize : 1));
      } else if (this.dialog.kind === "commandPalette") this.handlePaletteInput(data);
      else if (this.dialog.kind === "prompt") this.dialog = handlePromptInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "form") this.dialog = handleFormDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "confirm") this.dialog = handleConfirmInput(this.dialog, data, this.dialogContext(), this.confirmationReview);
      else if (this.dialog.kind === "archive") this.dialog = handleArchiveInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "picker") this.dialog = handlePickerDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "theme") this.dialog = handleThemeDialogInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "new" || this.dialog.kind === "repoPicker") this.dialog = handleNewSessionInput(this.dialog, data, this.dialogContext());
      else if (this.dialog.kind === "sessionFavorites") this.dialog = handleFavoritesInput(this.dialog, data, this.dialogContext());
      return;
    }

    if (this.busy) {
      if (this.themeLoading && matchesKey(data, Key.escape)) {
        this.themeLoadRequest += 1;
        this.themeLoading = false;
        this.busy = false;
        this.message = undefined;
      } else if (data === "q") {
        this.themeLoadRequest += 1;
        this.stop();
      }
      return;
    }

    this.reconcileCardPanel();
    if (this.cardPanel) {
      if (this.panelViewport.fallback && isEnterKey(data)) {
        this.executeDashboardCommand(`action:${this.cardPanel.target.managedId}:open`);
        return;
      }
      if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
        const step = this.panelViewport.pageSize;
        this.cardPanel.panel.offset = Math.max(0, Math.min(this.panelViewport.maxOffset, this.cardPanel.panel.offset + (matchesKey(data, Key.pageUp) ? -step : step)));
      } else this.cardPanel.handleInput(data);
      return;
    }
    if (!this.conversationOpen && this.grouping === "project" && !this.pinMode() && (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown))) {
      this.cardScrollOffset = Math.max(0, this.cardScrollOffset + (matchesKey(data, Key.pageUp) ? -1 : 1));
      return;
    }
    if (this.conversationOpen && this.handleConversationInput(data)) return;

    if (this.workspaceSessionId) {
      if (matchesKey(data, Key.escape)) {
        this.closeWorkspace();
        return;
      }
      const command = commandForKey(this.dashboardCommands(), data);
      if (command) this.executeDashboardCommand(command.id);
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.clearPendingRestart();
      this.message = undefined;
      this.clearFlash();
      if (this.controller.snapshot().filter !== undefined) this.applyFilter(undefined);
      return;
    }

    if (this.pendingRestart) {
      const result = handleRestartDialogInput(this.pendingRestart, data, this.dialogContext(), this.confirmationReview);
      if (result === "restart") this.confirmRestartSelected(false);
      else if (result === "new") this.confirmRestartSelected(true);
      else if (result === "all") this.confirmRestartAll();
      else if (result === "cancel") this.clearPendingRestart();
      else this.pendingRestart = result;
      return;
    }

    const direction = spatialDirection(data);
    if (direction) {
      this.focusSidePaneDirection(direction);
      return;
    }
    if (matchesKey(data, Key.ctrl("q"))) {
      this.returnToCockpit();
      return;
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
    if (this.releaseCueSelected) {
      if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
      else if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
      else if (isEnterKey(data)) this.dismissReleaseCue();
      else {
        const command = commandForKey(this.dashboardCommands(false, "select a visible session first"), data);
        if (command) this.executeDashboardCommand(command.id);
      }
      return;
    }
    if (this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo) {
      if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
      else if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
      else if (isEnterKey(data)) this.selectedRepo ? this.toggleRepo(this.selectedRepo) : this.selectedSection ? this.toggleSection(this.selectedSection) : this.toggleArchiveDisclosure();
      else if (data === "i") this.toggleInfo();
      else {
        const command = commandForKey(this.dashboardCommands(false, "select a session first"), data);
        if (command) this.executeDashboardCommand(command.id);
      }
      return;
    }

    if (matchesKey(data, Key.shift("right"))) {
      this.setAllSubagents(true);
      return;
    }
    if (matchesKey(data, Key.shift("left"))) {
      this.setAllSubagents(false);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.setSelectedSubagents(true);
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.setSelectedSubagents(false);
      return;
    }
    if (this.grouping === "stage" && data === " ") {
      this.toggleBoardSubagents();
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
    this.reconcileDeliveryResults();
    this.cardCommandHits = [];
    this.selectedRowAnimating = false;
    this.footerRow = undefined;
    this.footerItems = [];
    this.tierChipRow = undefined;
    this.tierChips = [];
    this.confirmationReview = undefined;
    this.dialogHits = [];
    this.dialogHitOwner = this.dialog ?? this.pendingRestart;
    this.clearExpiredFlash();
    this.lastWidth = width;
    if (this.conversationOpen && this.pinMode()) this.closeConversation();
    this.scheduleFollowRetarget();
    const selectedId = this.controller.selected()?.id;
    if (this.cardScrollSessionId !== selectedId) {
      this.cardScrollSessionId = selectedId;
      this.cardScrollOffset = 0;
    }
    if (this.grouping !== "stage") this.workspaceSessionId = undefined;
    if (this.revealedSessionId && selectedId !== this.revealedSessionId) this.revealedSessionId = undefined;
    if (this.workspaceSessionId && selectedId !== this.workspaceSessionId) this.closeWorkspace();
    if (this.workspaceSessionId && this.pinMode()) this.closeWorkspace();
    if (this.workspaceSessionId && width >= 120) this.workspaceSessionId = undefined;
    if (this.workspaceEvidenceSessionId && selectedId !== this.workspaceEvidenceSessionId) this.workspaceEvidenceSessionId = undefined;
    const height = this.actions.terminalRows?.() ?? process.stdout.rows;
    if (width < MIN_RENDER_WIDTH) {
      this.paletteRowTargets = [];
      this.paletteDetailRegion = undefined;
      this.conversationActionRows = [];
      this.conversationActions = [];
      if (this.inlineQuestion) { this.inlineQuestion.usable = false; this.inlineQuestion.rowTargets = []; }
      this.rowTargets = [];
      this.workspaceRowTargets = [];
      this.announcementRowTargets = [];
      this.listStartX = 2;
      this.workspaceStartX = undefined;
      this.listWidth = 0;
      return limitRows(narrowNotice(width), height, width, this.theme);
    }
    if (this.dialog || this.pendingRestart) {
      this.rowTargets = [];
      this.workspaceRowTargets = [];
      this.announcementRowTargets = [];
    }
    if (this.dialog && this.dialogNeedsRoom()) {
      return ["Resize to use this dialog", "Esc Back"].map((line) => truncateVisible(line, width)).slice(0, height);
    }
    if (this.dialog?.kind === "commandPalette" && (width <= NARROW_LAYOUT_MAX_WIDTH || (height && height < 9))) {
      const commands = this.dashboardCommands();
      const palette = renderCommandPalette(this.dialog.state, commands, width, height ?? commands.length + 6, this.theme, this.paletteTargetIdentities());
      this.dialog = { ...this.dialog, state: palette.state };
      this.paletteRowTargets = palette.rowTargets;
      this.paletteDetailRegion = palette.detailRegion;
      this.paletteBounds = { start: 0, end: palette.lines.length - 1 };
      return palette.lines;
    }
    if (this.dialog?.kind === "help") {
      const page = renderHelp(width, this.theme, this.actions.dashboardShortcuts, height, this.helpScroll);
      this.helpScroll = page.offset;
      this.helpPageSize = page.pageSize;
      this.helpMaxScroll = page.maxOffset;
      return page.lines;
    }
    const hits = this.dialogHits;
    if (this.dialog?.kind === "picker") return this.dialogRows(renderPickerDialog(this.dialog, width, this.dialogContext(), height, hits), height, width);
    if (this.dialog?.kind === "theme") return this.dialogRows(renderThemeDialog(this.dialog, width, height, this.theme, hits), height, width);
    if (this.dialog?.kind === "new" || this.dialog?.kind === "repoPicker") return this.dialogRows(renderNewSessionDialog(this.dialog, width, this.dialogContext(), hits), height, width);
    if (this.dialog?.kind === "sessionFavorites") return this.dialogRows(renderFavoritesDialog(this.dialog, width, this.dialogContext(), hits), height, width);
    if (this.dialog?.kind === "form") return this.dialogRows(renderFormDialog(this.dialog, width, this.dialogContext(), height, hits), height, width);
    if (this.dialog?.kind === "archive") return this.dialogRows(renderArchiveDialog(this.dialog, width, this.dialogContext(), hits), height, width);
    if (this.dialog?.kind === "confirm" || this.pendingRestart) {
      const rendered = this.dialog?.kind === "confirm"
        ? renderConfirmDialog(this.dialog, width, height, this.dialogContext(), hits)
        : renderRestartDialog(this.pendingRestart!, width, height, this.dialogContext(), hits);
      this.confirmationReview = rendered.review;
      return rendered.lines;
    }
    if (this.initialSelectionPending) {
      this.initialSelectionPending = false;
      if (!this.controller.hasExplicitSelection && !this.releaseCueSelected && !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo) {
        const first = this.visibleListTargets().find((target) => target.kind === "session");
        if (first?.kind === "session" && first.id !== this.controller.snapshot().selectedId) this.selectListTarget(first);
      }
    }
    this.normalizeListSelection();
    const snapshot = this.controller.snapshot();
    this.reconcileCardPanel();
    this.updateReplyPanel();
    const selected = this.controller.selected();
    const now = this.actions.now?.() ?? Date.now();
    const sidePaneState = this.pinState();
    const filter = (this.dialog?.kind === "prompt" ? (promptFilterValue(this.dialog) ?? snapshot.filter) : snapshot.filter)?.trim() || undefined;
    const structuralProjection = this.dashboardProjection(snapshot);
    const workspaceSelected = selected && structuralProjection.visible.some((session) => session.id === selected.id) ? selected : undefined;
    const panelHeight = this.conversationOpen ? Math.max(0, Math.min(Math.ceil((height || 24) * 0.65), (height || 24) - 4)) : 0;
    const fleetHeight = this.conversationOpen ? Math.max(4, (height || 24) - panelHeight) : height;
    const model = buildRenderModel({
      sessions: snapshot.sessions,
      selectedId: snapshot.selectedId,
      visibleRequestCount: this.visibleRequestIds().length,
      width,
      compactRows: this.conversationOpen,
      filter,
      filterDisclosure: this.filterDisclosure,
      filterEditing: this.dialog?.kind === "prompt" && this.dialog.purpose === "filter" ? this.dialog.draft : undefined,
      workspaceCommands: workspaceSelected && !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo
        ? selectWorkspaceCommands(workspaceSelected, this.dashboardCommands(), 3)
        : undefined,
      workspaceEvidenceVisible: workspaceSelected?.id === this.workspaceEvidenceSessionId,
      workspaceFullScreen: this.grouping === "stage" && width < 120 && workspaceSelected !== undefined && workspaceSelected.id === this.workspaceSessionId,
      cardPanel: this.cardPanel ? { ...this.cardPanel.panel, statusLine: this.message ?? this.flash?.text } : undefined,
      deliveryResults: new Map([...this.deliveryResults].map(([id, result]) => [id, result.text])),
      selectedQuestion: this.interaction.state?.questionProtocol && sameInteractionTarget(this.interaction.target, selected && this.actions.interactionTarget?.(selected)) ? this.interaction.state.pending[0]?.params.questions[0] : undefined,
      height: fleetHeight,
      listScrollTop: this.listScrollTop,
      cardScrollOffset: this.cardScrollOffset,
      grouping: this.grouping,
      fleetGrouping: this.fleetGrouping,
      now,
      pinSlots: sidePaneState.slots,
      activePinnedSessionId: sidePaneState.activeSessionId,
      pinCapacity: sidePaneState.capacity,
      pinConstrained: sidePaneState.constrained,
      pinsHidden: sidePaneState.hidden,
      following: sidePaneState.following === true,
      archiveExpanded: this.archiveExpanded,
      archiveDisclosureSelected: this.archiveDisclosureSelected,
      selectedSection: this.selectedSection,
      collapsedSections: this.collapsedSections,
      collapsedRepos: this.collapsedRepos,
      selectedRepo: this.selectedRepo,
      expandedBoardParentIds: this.expandedBoardParentIds,
      expandedProjectParentIds: this.expandedProjectParentIds,
      revealedSessionId: this.revealedSessionId,
      structuralProjection,
      attentionAnnouncements: this.dialog ? [] : this.activeAttentionAnnouncements(now),
      cockpitOnboarding: this.cockpitOnboarding,
      dismissedReleaseCueId: this.dismissedReleaseCueId,
      releaseCueEnabled: this.releaseCueEnabled,
      releaseCueSelected: this.releaseCueSelected,
      guidanceHidden: Boolean(this.dialog) || this.conversationOpen,
    });
    if (this.conversationOpen) { model.showWorkspace = false; model.workspace = undefined; model.footer = ""; }
    const layout = renderSessions(model, this.theme);
    this.rowTargets = layout.rowTargets;
    this.cardCommandHits = layout.cardCommandHits;
    this.panelViewport = layout.panelViewport ?? { pageSize: 1, maxOffset: 0 };
    this.selectedRowAnimating = !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo && !this.releaseCueSelected
      && (selected?.status === "running" || selected?.status === "starting")
      && layout.rowTargets.some((target) => target?.kind === "session" && target.id === selected.id);
    this.tierChipRow = layout.tierChipRow;
    this.tierChips = layout.tierChips;
    this.workspaceRowTargets = layout.workspaceRowTargets;
    this.announcementRowTargets = layout.announcementRowTargets;
    this.listStartX = layout.listStartX;
    this.workspaceStartX = layout.workspaceStartX;
    this.listWidth = layout.listWidth;
    this.listScrollTop = layout.listScrollTop;
    if (!this.dialog && !this.message && !this.flash && !this.conversationOpen) {
      this.footerRow = layout.footerRow;
      this.footerItems = layout.footerItems;
    }
    let withFooter = this.conversationOpen ? this.renderConversation(layout.lines, width, panelHeight) : layout.lines;
    this.paletteRowTargets = [];
    this.paletteBounds = undefined;
    this.paletteDetailRegion = undefined;
    if (this.dialog?.kind === "commandPalette") {
      const commands = this.dashboardCommands();
      this.dialog = { ...this.dialog, state: normalizeCommandPalette(this.dialog.state, commands) };
      const overlay = overlayCommandPalette(withFooter, this.dialog.state, commands, width, this.theme);
      withFooter = overlay.lines;
      this.paletteRowTargets = overlay.rowTargets;
      this.paletteBounds = overlay.bounds;
      const selectedRow = layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === selected?.id);
      if (overlay.bounds && selectedRow >= overlay.bounds.start && selectedRow <= overlay.bounds.end) this.selectedRowAnimating = false;
    }
    const final = this.conversationOpen || model.workspace?.panel ? withFooter : this.message
      ? replaceFooter(withFooter, this.message, this.theme)
      : this.flash
        ? replaceFooter(withFooter, this.flash.text, this.theme)
        : withFooter;
    return limitRows(final, height, width, this.theme);
  }

  disposeInteraction(): void {
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = undefined;
    this.interactionStopped = true; this.closeConversation(); this.interaction.setTarget(undefined);
  }

  async refreshInteraction(): Promise<void> {
    if (this.interactionStopped) return;
    this.normalizeListSelection();
    const question = this.inlineQuestion;
    const selected = this.selectedInteractionSession();
    const target = question?.target ?? (selected && this.actions.interactionTarget?.(selected));
    if (!sameInteractionTarget(target, this.interaction.target)) {
      this.interaction.setTarget(target);
      this.conversationReader.clear();
      this.olderConversationRequested = false;
    }
    if (!this.actions.loadInteractionState) return;
    const generation = this.conversationGeneration;
    await this.interaction.poll(this.actions.now?.() ?? Date.now(), this.actions.loadInteractionState, this.conversationOpen && this.actions.loadConversation ? async bound => {
      const older = this.olderConversationRequested;
      this.olderConversationRequested = false;
      const page = await this.actions.loadConversation!(bound, older ? { before: this.conversationReader.before, branchId: this.conversationReader.branchId } : undefined);
      const current = this.selectedInteractionSession();
      if (this.conversationOpen && generation === this.conversationGeneration && sameInteractionTarget(bound, current && this.actions.interactionTarget?.(current))) this.conversationReader.accept(page, older);
    } : undefined);
    if (question && this.inlineQuestion === question && !question.submitting) {
      const current = this.controller.snapshot().sessions.find(session => session.id === question.target.managedId);
      if (!sameInteractionTarget(question.target, current && this.actions.interactionTarget?.(current)) || (this.interaction.state && !this.interaction.state.pending.some(request => request.toolCallId === question.request.toolCallId))) {
        this.inlineQuestion = undefined;
        this.conversationFocus = "content";
        this.message = this.interaction.state?.questionUnavailableReason
          ? `${this.interaction.state.questionUnavailableReason}; Open in Pi`
          : "Question answered elsewhere or no longer available";
      } else if (this.interaction.state) { question.uncertain = false; question.available = true; }
      else if (this.interaction.error) question.available = false;
    }
    if (!this.inlineQuestion && this.conversationOpen) {
      const pending = this.interaction.state?.pending[0];
      if (selected && target && pending && this.actions.submitAnswer) {
        this.inlineQuestion = createQuestionDialog(target, selected.title, pending, selected.context?.attention?.requestId);
        if (this.conversationFocus !== "fleet" && !this.dialog) this.conversationFocus = "question";
      }
    }
    this.actions.requestRender?.();
  }

  /** Exact selected session id; undefined while a synthetic header, disclosure, or cue is selected. */
  get selectedSessionTarget(): string | undefined {
    if (this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo || this.releaseCueSelected) return undefined;
    return this.controller.selected()?.id;
  }

  /** True while the selected running/starting row is on screen and needs spinner frames. */
  get hasAnimatingSelectedRow(): boolean {
    return this.selectedRowAnimating;
  }

  get conversationWorking(): boolean {
    if (!this.conversationOpen || this.inlineQuestion || this.interaction.error || this.interaction.state?.pending.length) return false;
    const selected = this.selectedInteractionSession();
    const target = selected && this.actions.interactionTarget?.(selected);
    return selected?.status === "running" && !!target && sameInteractionTarget(target, this.interaction.target);
  }

  private selectedInteractionSession(): RuntimeSession | undefined {
    if (this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo || this.releaseCueSelected) return undefined;
    const selected = this.controller.selected();
    return selected && this.dashboardProjection(this.controller.snapshot()).visible.some(session => session.id === selected.id) ? selected : undefined;
  }

  private toggleConversation(): void {
    if (this.conversationOpen) { this.closeConversation(); return; }
    if (this.pinMode()) { this.message = "Close pinned panes to use Conversation"; return; }
    this.conversationOpen = true;
    this.conversationFocus = "content";
    this.closeWorkspace();
    this.interaction.invalidate();
    void this.refreshInteraction();
  }

  private closeConversation(): void {
    this.conversationOpen = false;
    this.conversationGeneration++;
    this.conversationReader.clear();
    this.inlineQuestion = undefined;
    this.conversationFocus = "fleet";
    this.conversationActions = [];
    this.conversationActionRows = [];
    this.olderConversationRequested = false;
  }

  private handleConversationInput(data: string): boolean {
    if (matchesKey(data, Key.escape)) { this.conversationFocus = "fleet"; return true; }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
      const cycle = ["fleet", ...(this.inlineQuestion ? ["question"] : []), "content", ...this.conversationActions.map(command => command.id)];
      this.conversationFocus = cycle[(cycle.indexOf(this.conversationFocus) + (matchesKey(data, Key.shift("tab")) ? -1 : 1) + cycle.length) % cycle.length]!;
      return true;
    }
    if (this.conversationFocus === "fleet") return false;
    if (this.lastWidth < MIN_RENDER_WIDTH || (this.actions.terminalRows?.() ?? 24) < 12) return data !== "c" && data !== "q";
    if (data === "c" && this.conversationFocus === "question" && !this.inlineQuestion?.custom) { this.closeConversation(); return true; }
    if (this.conversationFocus === "question" && this.inlineQuestion) {
      this.handleQuestion(data);
      return true;
    }
    if (this.conversationFocus !== "content" && isEnterKey(data)) {
      this.executeDashboardCommand(this.conversationFocus);
      return true;
    }
    if (matchesKey(data, Key.pageUp)) this.scrollConversation(-this.conversationReader.pageSize);
    else if (matchesKey(data, Key.pageDown)) this.scrollConversation(this.conversationReader.pageSize);
    else if (matchesKey(data, Key.home)) { this.conversationReader.home(); this.scrollConversation(-1); }
    else if (matchesKey(data, Key.end)) { this.conversationReader.end(); this.interaction.invalidate(); void this.refreshInteraction(); }
    else if (matchesKey(data, Key.up)) this.scrollConversation(-1);
    else if (matchesKey(data, Key.down)) this.scrollConversation(1);
    else if (isEnterKey(data)) return true;
    else return false;
    return true;
  }

  private scrollConversation(delta: number): void {
    this.conversationReader.scroll(delta);
    if (delta < 0 && this.conversationReader.atTop && this.conversationReader.before) {
      this.olderConversationRequested = true;
      this.interaction.invalidate();
      void this.refreshInteraction();
    }
  }

  private handleConversationMouse(event: MouseEvent): boolean {
    if (event.y === undefined || event.y < this.conversationStartY) return false;
    const localY = event.y - this.conversationStartY;
    if (this.inlineQuestion && localY >= this.conversationTranscriptEndY) {
      this.conversationFocus = "question";
      if (event.kind === "wheel") this.inlineQuestion.scroll = Math.max(0, this.inlineQuestion.scroll + event.delta * 3);
      else this.handleQuestionMouse({ ...event, y: localY - this.conversationTranscriptEndY + 1 });
      return true;
    }
    if (event.kind === "wheel") { this.conversationFocus = "content"; this.scrollConversation(event.delta * 3); return true; }
    const command = this.conversationActionRows[localY];
    this.conversationFocus = "content";
    if (command) this.executeDashboardCommand(command);
    return true;
  }

  private renderConversation(fleet: string[], width: number, height: number): string[] {
    if (height < 8) {
      this.conversationActionRows = [];
      if (this.inlineQuestion) { this.inlineQuestion.usable = false; this.inlineQuestion.rowTargets = []; }
      return [...fleet, truncateToWidth("Resize to read Conversation", width)];
    }
    const selected = this.selectedInteractionSession();
    const target = selected && this.actions.interactionTarget?.(selected);
    if (!sameInteractionTarget(target, this.interaction.target)) {
      this.interaction.setTarget(target); this.conversationReader.clear(); this.inlineQuestion = undefined; this.olderConversationRequested = false;
      if (this.conversationFocus !== "fleet") void this.refreshInteraction();
    }
    this.conversationStartY = fleet.length + 1;
    this.workspaceRowTargets = [];
    const commands = this.dashboardCommands();
    this.conversationActions = selected ? commands.filter(command => command.enabled && (command.id === `action:${selected.id}:open` || command.id.startsWith(`shortcut:${selected.id}:`))) : [];
    if (this.conversationFocus !== "fleet" && this.conversationFocus !== "content" && this.conversationFocus !== "question" && !this.conversationActions.some(command => command.id === this.conversationFocus)) this.conversationFocus = "content";
    const title = `CONVERSATION ${glyphs.pendingStep} ${selected ? `${selected.title} [${selected.group}]` : "Select a session"}`;
    if (this.inlineQuestion) {
      const transcriptLimit = height >= 12 ? Math.max(3, height - 12) : 0;
      const transcript = target && transcriptLimit ? this.conversationReader.render(width, transcriptLimit, this.theme, this.inlineQuestion.request.toolCallId) : [];
      this.conversationTranscriptEndY = 1 + transcript.length + (transcript.length ? 1 : 0);
      const answerHeight = height - this.conversationTranscriptEndY;
      const heading = renderConversationHeading(title, width, this.theme);
      const separator = this.theme ? styleToken(this.theme, "border", glyphs.horizontal.repeat(width)) : glyphs.horizontal.repeat(width);
      const answer = renderQuestionDialog(this.inlineQuestion, width, answerHeight, this.theme, this.conversationFocus === "question");
      this.conversationActionRows = [];
      return [...fleet, truncateToWidth(heading, width), ...transcript, ...(transcript.length ? [truncateToWidth(separator, width)] : []), ...answer].slice(0, fleet.length + height);
    }
    const actionHeight = Math.min(2, this.conversationActions.length);
    const actions = this.conversationActions.slice(0, actionHeight);
    const reason = !selected ? "Select a session" : !target ? selected.kind === "subagent" ? "Open in Pi for this subagent" : "Restart this session to enable Conversation" : this.interaction.error ?? (this.interaction.state?.questionUnavailableReason ? `${this.interaction.state.questionUnavailableReason} ${glyphs.pendingStep} Open in Pi` : selected.context?.attention?.kind === "question" && this.interaction.state?.questionProtocol === false ? `Direct answering unavailable ${glyphs.pendingStep} Open in Pi` : this.interaction.state?.shortcutDisabledReason);
    const transcriptHeight = Math.max(0, height - actions.length - 3);
    this.conversationTranscriptEndY = transcriptHeight + 1;
    const workingAt = this.conversationWorking ? (this.actions.now?.() ?? Date.now()) : undefined;
    const transcript = target ? this.conversationReader.render(width, transcriptHeight - (workingAt === undefined ? 0 : 1), this.theme) : [];
    const layout = renderConversationPane({ width, height, title, transcript, transcriptHeight, workingAt,
      status: this.message ?? this.flash?.text ?? reason ?? (this.conversationReader.newMessages ? `New messages ${glyphs.down} ${glyphs.pendingStep} End Latest` : `${this.conversationFocus === "fleet" ? "Fleet focused" : "Conversation focused"} ${glyphs.pendingStep} Tab Focus ${glyphs.pendingStep} PgUp/PgDn Read ${glyphs.pendingStep} c Hide`), actions, focusedAction: this.conversationFocus }, this.theme);
    this.conversationActionRows = layout.actionRows;
    return [...fleet, ...layout.lines];
  }

  private openQuestion(): void {
    const selected = this.selectedInteractionSession();
    const target = selected && this.actions.interactionTarget?.(selected);
    const request = this.interaction.state?.pending[0];
    if (!selected || !target || !sameInteractionTarget(target, this.interaction.target) || !request || !this.actions.submitAnswer) { this.message = `${this.interaction.state?.questionUnavailableReason ?? "Direct answering unavailable"}; Open in Pi`; return; }
    if (!this.conversationOpen) this.conversationOpen = true;
    this.inlineQuestion = createQuestionDialog(target, selected.title, request, selected.context?.attention?.requestId);
    this.conversationFocus = "question";
    this.closeWorkspace();
  }

  private handleQuestion(data: string): void {
    const dialog = this.inlineQuestion;
    if (!dialog) return;
    const result = handleQuestionInput(dialog, data);
    dialog.rowTargets = [];
    if (result === "close") this.conversationFocus = "fleet";
    if (result === "submit") void this.submitQuestion(dialog);
  }

  private handleQuestionMouse(event: MouseEvent): void {
    const dialog = this.inlineQuestion;
    if (!dialog) return;
    if (event.kind === "wheel") { dialog.scroll = Math.max(0, dialog.scroll + event.delta * 3); return; }
    if (!dialog.usable || dialog.submitting) return;
    const target = dialog.rowTargets[event.y - 1];
    const footerItem = event.y === dialog.rowTargets.length
      ? dialog.footerItems.find(item => event.x >= item.x && event.x < item.x + item.width)
      : undefined;
    if (target === "back" || footerItem?.key === "Esc") { this.handleQuestion("\x1b"); return; }
    if (!dialog.available || dialog.uncertain) return;
    if (typeof target === "number") this.handleQuestion(target < dialog.request.params.questions[dialog.page]!.options.length ? String(target + 1) : "t");
    else if ((target === "next" || target === "submit") && footerItem?.key === "Enter") this.handleQuestion("\r");

  }

  private async submitQuestion(dialog: QuestionDialog): Promise<void> {
    if (dialog.submitting || dialog.uncertain || !dialog.available || !this.actions.submitAnswer) return;
    const current = this.selectedInteractionSession();
    if (!sameInteractionTarget(dialog.target, current && this.actions.interactionTarget?.(current))) {
      this.inlineQuestion = undefined; this.conversationFocus = "content"; this.message = "Question is no longer available"; return;
    }
    dialog.submitting = true;
    try {
      await this.actions.submitAnswer(dialog.target, dialog.request.toolCallId, dialog.answers);
      if (this.inlineQuestion === dialog) { this.inlineQuestion = undefined; this.conversationFocus = "content"; }
      const session = this.controller.snapshot().sessions.find(session => session.id === dialog.target.managedId);
      if (dialog.attentionRequestId && session?.context?.attention?.requestId === dialog.attentionRequestId && sameInteractionTarget(dialog.target, this.actions.interactionTarget?.(session))) await this.acknowledgeSession(session.id, dialog.attentionRequestId);
      this.message = undefined;
      this.flashMessage("Answer accepted");
    } catch (error) {
      dialog.error = errorMessage(error);
      if (/stale|answered elsewhere|no longer|unavailable/i.test(dialog.error)) { if (this.inlineQuestion === dialog) { this.inlineQuestion = undefined; this.conversationFocus = "content"; } this.message = dialog.error; }
      else if (/not confirmed|timeout|timed out/i.test(dialog.error)) { dialog.uncertain = true; this.interaction.state = undefined; }
    } finally {
      dialog.submitting = false; this.interaction.invalidate();
      void this.refreshInteraction(); this.actions.requestRender?.();
    }
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
    return this.dialog?.kind === "form" && this.dialog.purpose === "renameSession";
  }

  /** Opens the top NEEDS YOU session other than the origin through the Enter path. */
  openNextRequest(fromTmuxSession: string): boolean {
    const target = needsYouOwners(this.controller.snapshot().sessions).find((session) => session.tmuxSession !== fromTmuxSession);
    if (!target) {
      this.message = "nothing else needs you";
      return false;
    }
    if (!this.revealSession(target.id)) return false;
    this.attachSelected();
    return true;
  }

  private visibleRequestIds(): string[] {
    const sessions = new Map(this.controller.snapshot().sessions.map((session) => [session.id, session]));
    return this.visibleListTargets().flatMap((target) => {
      if (target.kind !== "session") return [];
      const session = sessions.get(target.id);
      return session && visibleAttention(session) ? [target.id] : [];
    });
  }

  private selectNextRequest(): void {
    const ids = new Set(this.visibleRequestIds());
    const current = this.releaseCueSelected || this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo
      ? undefined
      : this.controller.snapshot().selectedId;
    const targets = this.visibleListTargets();
    const position = targets.findIndex((target) => target.kind === "session" && target.id === current);
    const next = [...targets.slice(position + 1), ...targets.slice(0, position + 1)]
      .find((target) => target.kind === "session" && ids.has(target.id));
    if (next) this.selectListTarget(next);
  }

  private toggleInfo(): void {
    if (this.conversationOpen) this.closeConversation();
    if (this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo) {
      this.flashMessage("select a session to show status evidence");
      return;
    }
    const selected = this.controller.selected();
    if (!selected) return;
    const selectedId = selected.id;
    if (this.workspaceEvidenceSessionId === selectedId) {
      this.workspaceEvidenceSessionId = undefined;
      return;
    }
    const reveal = (requireEvidence = false) => {
      const current = this.controller.selected();
      if (current?.id !== selectedId) return;
      if (requireEvidence && !current.statusEvidence) {
        this.message = "status evidence unavailable after refresh";
        return;
      }
      if (this.grouping === "stage" && this.lastWidth < 120) this.workspaceSessionId = selectedId;
      this.workspaceEvidenceSessionId = selectedId;
    };
    const refresh = this.actions.navigationActions?.refreshStatusEvidence ?? this.actions.refreshStatusEvidence;
    if (selected.statusEvidence || !refresh) {
      reveal();
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.runAction(() => refresh(), "refreshing status evidence...", () => reveal(true));
  }

  private closeWorkspace(): void {
    this.workspaceSessionId = undefined;
    this.workspaceEvidenceSessionId = undefined;
    this.cardScrollOffset = 0;
  }

  private dialogContext(): DialogContext {
    return {
      viewport: { width: this.lastWidth, height: this.actions.terminalRows?.() ?? process.stdout.rows },
      controller: this.controller,
      actions: this.actions,
      theme: this.theme,
      now: () => this.actions.now?.() ?? Date.now(),
      close: () => { this.dialog = undefined; },
      setDialog: (dialog) => { this.dialog = dialog; },
      dialog: () => this.dialog,
      setMessage: (message) => { this.message = message; },
      setFilter: (filter) => this.applyFilter(filter),
      message: () => this.message,
      flashMessage: (text) => this.flashMessage(text),
      runAction: (action, pending, onSuccess) => this.runAction(action, pending, onSuccess),
      revealSession: (sessionId) => { this.revealSession(sessionId); },
      attachSession: (session) => this.attachSession(session),
      stop: () => this.stop(),
    };
  }

  private openDialog(open: (ctx: DialogContext) => SessionDialog | undefined) {
    const dialog = open(this.dialogContext());
    if (!dialog) return;
    this.confirmationReview = undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.dialog = dialog;
  }

  private startFilter() {
    if (this.controller.snapshot().registry.sessions.length === 0) return;
    if (this.workspaceSessionId) this.closeWorkspace();
    this.revealedSessionId = undefined;
    this.openDialog(openFilterPrompt);
  }

  private applyFilter(filter: string | undefined): void {
    const normalized = filter === undefined ? undefined : serializeDashboardFilter(parseDashboardFilter(filter));
    if (normalized !== this.controller.snapshot().filter) {
      this.filterDisclosure = { sections: new Set(), repos: new Set(), projectTrees: new Set(), boardTrees: new Set() };
    }
    this.controller.setFilter(normalized);
    this.revealedSessionId = undefined;
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.selectedRepo = undefined;
    this.listScrollTop = 0;
    this.viewStateRevision += 1;
    this.saveViewState();
  }

  private startNewDialog() {
    this.openDialog(openNewSessionDialog);
  }

  private startForkDialog(compact = false) {
    this.openDialog(compact ? openForkCompactDialog : openForkDialog);
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

  private pinState(): SidePaneViewState {
    return this.actions.sidePaneState?.() ?? {
      slots: [undefined, undefined, undefined, undefined],
      capacity: 0,
      constrained: false,
      splitPercent: 50,
    };
  }

  private pinMode(): boolean {
    return this.pinState().slots.some(Boolean) && !this.pinState().hidden;
  }

  private activeAttentionAnnouncements(now = this.actions.now?.() ?? Date.now()): readonly AttentionAnnouncement[] {
    const sessions = new Map(this.controller.snapshot().sessions.map((session) => [session.id, session]));
    return this.attentionAnnouncements.filter((announcement) => {
      const session = sessions.get(announcement.sessionId);
      return now < announcement.expiresAt
        && session?.context?.attention?.requestId === announcement.requestId
        && (session.status === "waiting" || session.status === "idle")
        && (session.acknowledgedAt ?? -1) < announcement.announcedAt;
    });
  }

  private dashboardCommands(includeSelected = true, interactionBlockedReason?: string): DashboardCommand[] {
    const snapshot = this.controller.snapshot();
    const blockedReason = interactionBlockedReason ?? ((this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo || (this.grouping === "stage" && !this.boardRows().length))
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
      answerQuestion: Boolean(this.actions.submitAnswer),
      copyPath: Boolean(this.actions.copy),
      skills: Boolean(this.actions.skills),
      mcp: Boolean(this.actions.mcpServers),
      theme: !noColor() && Boolean(this.actions.themeSettings),
      pinSidePane: Boolean(this.actions.pinSidePane),
      assignSidePaneSlot: Boolean(this.actions.assignSidePaneSlot),
      focusSidePaneSlot: Boolean(this.actions.focusSidePaneSlot),
      closeSidePane: Boolean(this.actions.closeSidePane),
      resizeSidePane: Boolean(this.actions.resizeSidePane),
      followSidePane: Boolean(this.actions.followSidePane && this.actions.unfollowSidePane),
      focusFollow: Boolean(this.actions.focusFollow),
      acknowledge: true,
      attentionBell: Boolean(this.actions.attentionDelivery?.setAttentionBell),
      followDefault: Boolean(this.actions.followPreference),
    };
    return buildDashboardCommands({
      sessions: this.commandSessions(snapshot),
      selectedId: selectedVisible?.id,
      deliveryResult: selectedVisible ? this.deliveryResults.get(selectedVisible.id)?.state : undefined,
      filter: snapshot.filter,
      grouping: this.grouping,
      fleetGrouping: this.fleetGrouping,
      configuredShortcuts: this.actions.dashboardShortcuts,
      conversation: this.conversationOpen,
      interactionState: sameInteractionTarget(this.interaction.target, selectedVisible && this.actions.interactionTarget?.(selectedVisible)) ? this.interaction.state : undefined,
      capabilities,
      attentionRequests: this.activeAttentionAnnouncements().map(({ sessionId, requestId }) => ({ sessionId, requestId })),
      attentionBellEnabled: this.actions.attentionDelivery?.attentionBellEnabled?.() ?? false,
      followDefaultEnabled: this.actions.followPreference?.followDefault() ?? false,
      visibleRequestCount: this.visibleRequestIds().length,
      pinState: {
        slots: this.pinState().slots,
        activeSessionId: this.pinState().activeSessionId,
        count: this.pinState().slots.filter(Boolean).length,
        capacity: this.pinState().capacity,
        constrained: this.pinState().constrained,
        following: this.pinState().following === true,
      },
      interactionBlockedReason: blockedReason,
    });
  }

  private commandSessions(snapshot: ReturnType<SessionsController["snapshot"]>) {
    const unfiltered = buildDashboardProjection({
      sessions: snapshot.sessions,
      grouping: this.grouping,
      fleetGrouping: this.fleetGrouping,
      archiveExpanded: this.archiveExpanded,
      collapsedSections: this.collapsedSections,
      collapsedRepos: this.collapsedRepos,
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

  private dialogNeedsRoom(): boolean {
    if (this.lastWidth < MIN_RENDER_WIDTH) return true;
    const height = this.actions.terminalRows?.() ?? process.stdout.rows;
    return this.lastWidth <= NARROW_LAYOUT_MAX_WIDTH && Boolean(height && height < 10 && this.dialog
      && ["form", "new", "repoPicker", "sessionFavorites", "theme"].includes(this.dialog.kind));
  }

  private paletteTargetIdentities(): ReadonlyMap<string, CommandPaletteTargetIdentity> {
    return new Map(this.controller.snapshot().registry.sessions.map((session) => [session.id, {
      title: session.title, group: session.group, repository: session.cwd,
    }]));
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
    if ((this.lastWidth < MIN_RENDER_WIDTH || (height && height < 6)) && isEnterKey(data)) return;
    const commands = this.dashboardCommands();
    const result = handleCommandPaletteInput(this.dialog.state, data, commands, this.paletteDetailRegion?.pageSize, this.paletteDetailRegion?.maxOffset);
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

  /** Keeps only hits on rows that survive height limiting. */
  private dialogRows(lines: string[], height: number | undefined, width: number): string[] {
    const limited = limitRows(lines, height, width, this.theme);
    const lastRow = limited.length === lines.length ? limited.length : limited.length - 1;
    this.dialogHits = this.dialogHits.filter((hit) => hit.row < lastRow);
    return limited;
  }

  private handleDialogMouse(event: MouseEvent): boolean {
    if ((this.dialog ?? this.pendingRestart) !== this.dialogHitOwner || this.dialogNeedsRoom()) return false;
    if (event.kind === "wheel") {
      const keys = this.dialogWheelKeys();
      if (!keys) return false;
      this.handleInput(event.delta < 0 ? keys[0] : keys[1]);
      return true;
    }
    const hit = hitAt(this.dialogHits, event.y - 1, event.x);
    if (!hit) return false;
    const now = this.actions.now?.() ?? Date.now();
    const target = `dialog:${hit.id}`;
    const elapsed = this.lastMouseClick?.target === target ? now - this.lastMouseClick.at : undefined;
    const doubleClick = elapsed !== undefined && elapsed >= 0 && elapsed <= DOUBLE_CLICK_MS;
    if (hit.select) this.dialog = hit.select(this.dialogContext());
    if (hit.key) this.handleInput(hit.key);
    if (doubleClick && hit.confirm) this.handleInput(hit.confirm);
    this.lastMouseClick = doubleClick ? undefined : { target, at: now };
    return true;
  }

  private dialogWheelKeys(): [string, string] | undefined {
    if (this.pendingRestart || this.dialog?.kind === "confirm") return [PAGE_UP, PAGE_DOWN];
    if (this.dialog?.kind === "theme" || this.dialog?.kind === "picker" || this.dialog?.kind === "repoPicker"
      || (this.dialog?.kind === "sessionFavorites" && this.dialog.mode === "picker")) return [UP, DOWN];
    return undefined;
  }

  private handlePaletteMouse(event: MouseEvent): void {
    if (this.dialog?.kind !== "commandPalette") return;
    const row = event.kind === "press" ? event.y - 1 : undefined;
    if (row !== undefined && this.paletteBounds && row >= this.paletteBounds.start && row <= this.paletteBounds.end && !this.paletteRowTargets[row]) return;
    const commands = this.dashboardCommands();
    if (row !== undefined && this.lastWidth > NARROW_LAYOUT_MAX_WIDTH && this.paletteBounds && (row < this.paletteBounds.start || row > this.paletteBounds.end)) {
      this.dialog = undefined;
      return;
    }
    const result = handleCommandPaletteMouse(this.dialog.state, event, this.paletteRowTargets, commands, this.paletteDetailRegion);
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
      this.message = `${command.disabledReason ?? "command unavailable"}${command.id.endsWith(":send") ? "; Open in Pi" : ""}`;
      return;
    }
    if (command.id.startsWith("session:")) {
      this.revealSession(command.targetSessionId);
      return;
    }
    if (command.id.startsWith("view:locate-attention:")) {
      const active = this.activeAttentionAnnouncements().find((announcement) =>
        announcement.sessionId === command.targetSessionId && announcement.requestId === command.attentionRequestId);
      const current = command.targetSessionId ? this.controller.snapshot().sessions.find((session) => session.id === command.targetSessionId) : undefined;
      if (!active || current?.context?.attention?.requestId !== command.attentionRequestId) {
        this.message = "request is no longer active";
        return;
      }
      this.revealSession(command.targetSessionId);
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
      if (action.startsWith("dismiss-result:")) { this.deliveryResults.delete(command.targetSessionId); return; }
      if (action.startsWith("answer:")) { this.openQuestion(); return; }
      if (action.startsWith("copy-path:")) { this.copyHandoffPath(command.targetSessionId); return; }
      const slot = action.match(/^slot-([1-4])$/)?.[1];
      if (slot) {
        this.closeConversation();
        this.assignSidePaneSlot(command.targetSessionId, Number(slot) as 1 | 2 | 3 | 4);
        return;
      }
      switch (action) {
        case "focus-follow": this.focusFollow(command.targetSessionId!); return;
        case "open": this.attachSelected(); return;
        case "restart": this.restartSelected(); return;
        case "send": this.startReply(); return;
        case "rename": this.startRenameSessionDialog(); return;
        case "sync-name": this.syncPiNameSelected(); return;
        case "fork": this.startForkDialog(); return;
        case "fork-compact": this.startForkDialog(true); return;
        case "move-group": this.startGroupDialog(); return;
        case "rename-group": this.startRenameGroupDialog(); return;
        case "archive": this.openDialog((ctx) => openArchiveDialog(ctx, command.targetSessionId!)); return;
        case "backlog": this.backlogSelected(); return;
        case "restore": this.restoreSelectedBucket(); return;
        case "delete": this.startDeleteDialog(); return;
        case "finish-worktree": this.startFinishDialog(); return;
        case "skills": this.startPicker("skills"); return;
        case "mcp": this.startPicker("mcp"); return;
        case "pin": this.closeConversation(); this.pinSidePane(command.targetSessionId); return;
        case "close-pin": this.closeSidePane(command.targetSessionId); return;
        case "size-increase": this.resizeSidePane(1); return;
        case "size-decrease": this.resizeSidePane(-1); return;
        case "info": this.toggleInfo(); return;
        case "mark-read": {
          const requestId = this.controller.snapshot().sessions.find((session) => session.id === command.targetSessionId)?.context?.attention?.requestId;
          this.runAction(() => this.acknowledgeSession(command.targetSessionId!, requestId), "marking read...");
          return;
        }
        case "reorder-up": this.reorderSelected(-1); return;
        case "reorder-down": this.reorderSelected(1); return;
      }
    }
    const focusSlot = command.id.match(/^view:focus-slot-([1-4])$/)?.[1];
    if (focusSlot) {
      this.focusSidePaneSlot(Number(focusSlot) as 1 | 2 | 3 | 4);
      return;
    }
    switch (command.id) {
      case "project:skills": this.startPicker("skills"); return;
      case "project:mcp": this.startPicker("mcp"); return;
      case "action:new": this.startNewDialog(); return;
      case "view:conversation": this.toggleConversation(); return;
      case "view:follow": this.toggleFollow(command.targetSessionId); return;
      case "view:theme": this.startThemeDialog(); return;
      case "view:attention-bell": this.toggleAttentionBell(); return;
      case "view:follow-default": this.toggleFollowDefault(); return;
      case "view:backlog": this.toggleBacklogFilter(); return;
      case "view:grouping": this.closeConversation(); this.toggleGrouping(); return;
      case "view:fleet-grouping": this.closeConversation(); this.toggleFleetGrouping(); return;
      case "view:palette": this.openCommandPalette(); return;
      case "view:next-request": this.selectNextRequest(); return;
      case "view:help": this.helpScroll = 0; this.dialog = { kind: "help" }; return;
      case "view:quit": this.stop(); return;
    }
    this.message = "command is not implemented";
  }

  private reconcileCardPanel(): void {
    const sessions = this.controller.snapshot().sessions;
    for (const [id, draft] of this.replyDrafts) {
      const session = sessions.find(row => row.id === id);
      if (!sameInteractionTarget(draft.target, session && this.actions.interactionTarget?.(session))) this.replyDrafts.delete(id);
    }
    if (!this.cardPanel) return;
    const selected = this.controller.selected();
    if (this.archiveDisclosureSelected || this.selectedSection || this.selectedRepo || this.releaseCueSelected || !sameInteractionTarget(this.cardPanel.target, selected && this.actions.interactionTarget?.(selected))) {
      this.cardPanel = undefined;
      this.replyEditor = undefined;
    }
  }

  private reconcileDeliveryResults(): void {
    const sessions = this.controller.snapshot().sessions;
    for (const [id, result] of this.deliveryResults) {
      const session = sessions.find(row => row.id === id);
      const target = session && this.actions.interactionTarget?.(session);
      if (!session || !sameInteractionTarget(result.target, target) || (result.state === "accepted" && session.status === "running" && result.status !== "running")) this.deliveryResults.delete(id);
      else result.status = session.status;
    }
  }

  /** All card writers (including reply/answer panels) share the same exact-target receipt. */
  async writeInteraction(target: InteractionTarget, what: string, write: () => unknown): Promise<unknown> {
    this.reconcileDeliveryResults();
    if (this.deliveryResults.get(target.managedId)?.state === "submitting") throw new Error("write is submitting");
    const session = this.controller.snapshot().sessions.find(row => row.id === target.managedId);
    if (!session || !sameInteractionTarget(target, this.actions.interactionTarget?.(session))) throw new Error("write target changed");
    const result = { target, state: "submitting" as "submitting" | "accepted" | "rejected" | "unknown", text: `Submitting${glyphs.ellipsis}`, status: session.status };
    this.deliveryResults.set(target.managedId, result);
    this.actions.requestRender?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let value: unknown;
    try {
      value = await Promise.race([Promise.resolve(write()), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(DELIVERY_UNCONFIRMED)), INTERACTION_TIMEOUT_MS);
      })]);
      result.state = "accepted";
      result.text = `Accepted ${glyphs.pendingStep} ${what}`;
    } catch (error) {
      const reason = errorMessage(error);
      const unknown = reason === DELIVERY_UNCONFIRMED || /timeout|timed out/i.test(reason);
      result.state = unknown ? "unknown" : "rejected";
      result.text = unknown ? `Delivery unknown ${glyphs.pendingStep} Check Pi before retrying` : `Rejected ${glyphs.pendingStep} ${reason}`;
      throw error;
    } finally {
      clearTimeout(timer);
      this.actions.requestRender?.();
    }
    try {
      await this.actions.afterInteractionWrite?.(target);
    } catch (error) {
      this.message = `Accepted, but activity update failed: ${errorMessage(error)}`;
    }
    return value;
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
      () => {
        const identity = this.actions.interactionTarget?.(target);
        if (!identity) throw new Error("shortcut target is no longer available");
        return this.writeInteraction(identity, shortcut.label ?? shortcut.send, () => this.actions.runDashboardShortcut!(target.id, shortcut));
      },
      "running shortcut...",
      () => { this.flashMessage(`${shortcut.label ?? "shortcut sent"} ${glyphs.right} ${target.title}`); },
    );
  }

  private toggleBacklogFilter(): void {
    const parsed = parseDashboardFilter(this.controller.snapshot().filter);
    const lifecycle = new Set(parsed.lifecycle);
    if (lifecycle.has("backlog")) lifecycle.delete("backlog");
    else lifecycle.add("backlog");
    this.applyFilter(serializeDashboardFilter({ lifecycle, ...(parsed.text ? { text: parsed.text } : {}) }));
  }

  private executeFilterCommand(commandId: string): void {
    if (commandId === "filter:open") {
      this.startFilter();
      return;
    }
    let filter: string | undefined;
    if (commandId === "filter:clear") filter = undefined;
    else if (commandId.startsWith("filter:lifecycle:")) filter = `lifecycle:${commandId.slice("filter:lifecycle:".length)}`;
    else if (commandId.startsWith("filter:status:")) filter = commandId.slice("filter:status:".length);
    else if (commandId.startsWith("filter:group:")) filter = decodeURIComponent(commandId.slice("filter:group:".length));
    else {
      this.message = "filter command is not implemented";
      return;
    }
    this.revealedSessionId = undefined;
    this.applyFilter(filter);
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.listScrollTop = 0;
  }

  revealSession(targetId: string | undefined): boolean {
    this.releaseCueSelected = false;
    if (!targetId) {
      this.message = "session is no longer available";
      return false;
    }
    const snapshot = this.controller.snapshot();
    const target = snapshot.sessions.find((session) => session.id === targetId);
    if (!target) {
      this.message = "session is no longer available";
      return false;
    }
    if (!this.controller.selectSession(targetId)) {
      this.controller.setFilter(undefined);
      if (!this.controller.selectSession(targetId)) {
        this.message = "session is no longer available";
        return false;
      }
    }
    const unfiltered = buildDashboardProjection({ sessions: this.controller.snapshot().sessions, grouping: this.grouping });
    const current = unfiltered.allTree.get(targetId);
    const ownerId = current ? (unfiltered.allTree.trace(current).owner ?? unfiltered.allTree.trace(current).terminal).id : targetId;
    const revealsDescendant = targetId !== ownerId;
    if (this.grouping === "stage") {
      const expandedParentIds = revealsDescendant ? new Set([ownerId]) : undefined;
      const projection = buildDashboardProjection({ sessions: this.controller.snapshot().sessions, grouping: "stage", expandedBoardParentIds: expandedParentIds });
      if (projection.visible.some((session) => session.id === targetId)) {
        if (revealsDescendant) this.expandedBoardParentIds.add(ownerId);
      } else this.grouping = "project";
    }
    if (this.grouping === "project" && revealsDescendant) this.expandedProjectParentIds.add(ownerId);
    this.revealedSessionId = targetId;
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.selectedRepo = undefined;
    this.listScrollTop = 0;
    this.viewStateRevision += 1;
    return true;
  }

  private startReply(): void {
    this.reconcileCardPanel();
    const selected = this.controller.selected();
    const target = selected && this.actions.interactionTarget?.(selected);
    if (!selected || !target || !sameInteractionTarget(target, this.interaction.target) || !this.interaction.state?.messageDelivery) {
      this.message = "Reload Pi in this session to enable message delivery; Open in Pi";
      return;
    }
    let draft = this.replyDrafts.get(selected.id);
    if (!draft) {
      const attention = visibleAttention(selected);
      draft = { target, input: createTextInput(attention?.kind === "ready" && attention.recommendation ? `Go ahead: ${stripAnsi(attention.recommendation)}` : ""),
        delivery: this.interaction.state.messageDelivery === "busy" ? "steer" : "send", deliveryFocus: false };
      this.replyDrafts.set(selected.id, draft);
    } else {
      draft.delivery = this.interaction.state.messageDelivery === "idle" ? "send" : draft.delivery === "send" ? "steer" : draft.delivery;
      draft.deliveryFocus = false;
    }
    this.closeConversation();
    this.message = undefined;
    this.clearFlash();
    this.setCardPanel(target, { body: [], keyLine: "", offset: 0 }, data => this.handleReplyInput(draft!, data));
    this.replyEditor = draft;
    this.updateReplyPanel();
  }

  private updateReplyPanel(): void {
    const draft = this.replyEditor;
    if (!draft || !this.cardPanel) return;
    const title = stripAnsi(this.controller.snapshot().sessions.find(row => row.id === draft.target.managedId)!.title);
    const label = draft.delivery === "send" ? "Send" : draft.delivery === "steer" ? "Steer now" : "Queue for later";
    const narrow = this.lastWidth < 60;
    this.cardPanel.panel.body = [
      ["REPLY", ...(!narrow ? [title] : []), label].join(` ${glyphs.pendingStep} `),
      draft.input,
      ...(draft.delivery === "send" || narrow ? [] : [
        `${draft.deliveryFocus ? glyphs.selected : " "} Tab Delivery: ${glyphs.left} ${label} ${glyphs.right}`,
        draft.delivery === "steer" ? "Use before the next model call, after current tools" : "Use after the current run",
      ]),
    ];
    this.cardPanel.panel.keyLine = narrow && draft.delivery !== "send" ? [
      `Tab Delivery${draft.deliveryFocus ? ` ${glyphs.selected}` : ""}`,
      `${glyphs.left}/${glyphs.right} Steer/Queue`,
      `Enter ${label}`,
      "Esc Keep draft",
    ].join("\n") : `Enter ${draft.delivery === "send" ? "Send" : draft.delivery === "steer" ? "Steer" : "Queue"} ${glyphs.pendingStep} Esc Keep draft ${glyphs.pendingStep} Ctrl+U Clear${draft.delivery === "send" ? "" : ` ${glyphs.pendingStep} Tab Delivery ${glyphs.pendingStep} ${glyphs.left}/${glyphs.right} Steer/Queue`}`;
  }

  private handleReplyInput(draft: ReplyDraft, data: string): void {
    if (matchesKey(data, Key.escape)) { this.clearCardPanel(); this.message = undefined; return; }
    if (draft.submitting || this.deliveryResults.get(draft.target.managedId)?.state === "submitting") return;
    if (matchesKey(data, Key.ctrl("u"))) draft.input = createTextInput();
    else if (isEnterKey(data)) { this.submitReply(draft); return; }
    else if (draft.delivery !== "send" && matchesKey(data, Key.tab)) draft.deliveryFocus = !draft.deliveryFocus;
    else if (draft.deliveryFocus) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) draft.delivery = draft.delivery === "steer" ? "followUp" : "steer";
    } else draft.input = editTextInput(data, draft.input) ?? draft.input;
    this.message = undefined;
    this.updateReplyPanel();
  }

  private submitReply(draft: ReplyDraft): void {
    if (!draft.input.value.trim()) { this.message = "message is required"; return; }
    const command = this.dashboardCommands().find(command => command.id === `action:${draft.target.managedId}:send`);
    const busyRace = draft.delivery === "send" && this.interaction.state?.messageDelivery === "busy";
    const label = draft.delivery === "send" ? "Sent" : draft.delivery === "steer" ? "Steer requested" : "Queued";
    draft.submitting = true;
    void this.writeInteraction(draft.target, label, () => {
      if (!command?.enabled) throw new Error(command?.disabledReason ?? "reply target is no longer available");
      if (busyRace) throw new Error("Pi started working; choose Steer now or Queue for later");
      return this.actions.sendMessage!(draft.target, draft.input.value, draft.delivery);
    }).then(() => {
      draft.input = createTextInput();
      draft.delivery = "send";
      draft.deliveryFocus = false;
      if (this.replyEditor === draft) this.clearCardPanel();
    }).catch(error => {
      if (/Pi started working/.test(errorMessage(error))) { draft.delivery = "steer"; draft.deliveryFocus = false; }
      this.reconcileCardPanel();
      this.updateReplyPanel();
    }).finally(() => {
      draft.submitting = false;
      this.actions.requestRender?.();
    });
  }

  private pinSidePane(sessionId: string) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const session = this.controller.snapshot().sessions.find((item) => item.id === sessionId);
    const pin = this.actions.pinSidePane;
    if (!session || !pin) {
      this.message = session ? "pin transport unavailable" : "session is no longer available";
      return;
    }
    const pending = `pinning ${session.title}...`;
    runSyncAsyncAction(() => pin(sessionId), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result: SidePaneResult) => {
        if (result.kind === "capacity") this.flashMessage(result.capacity ? `pin capacity ${result.capacity}; close a pin or widen` : "pinning needs 100 columns; use Enter instead");
        else this.flashMessage(result.kind === "focused" ? `focused ${glyphs.pendingStep} ${session.title}` : `pinned ${glyphs.pendingStep} ${session.title}`);
      },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private assignSidePaneSlot(sessionId: string, slot: 1 | 2 | 3 | 4) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const session = this.controller.snapshot().sessions.find((item) => item.id === sessionId);
    const assign = this.actions.assignSidePaneSlot;
    if (!session || !assign) {
      this.message = session ? "slot assignment unavailable" : "session is no longer available";
      return;
    }
    const pending = `assigning slot ${slot}...`;
    runSyncAsyncAction(() => assign(sessionId, slot), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result: SidePaneResult) => {
        if (result.kind === "occupied") {
          const occupant = this.controller.snapshot().sessions.find((item) => item.tmuxSession === result.session)?.title ?? result.session;
          this.flashMessage(`Slot ${slot} contains ${occupant}; close it first`);
        } else if (result.kind === "capacity") {
          this.flashMessage(result.capacity ? `pin capacity ${result.capacity}; close a pin or widen` : "pinning needs 100 columns; use Enter instead");
        } else this.flashMessage(result.kind === "focused" ? `focused slot ${slot} ${glyphs.pendingStep} ${session.title}` : `slot ${slot} ${glyphs.pendingStep} ${session.title}`);
      },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private followView(): boolean {
    return this.pinState().following === true;
  }

  /**
   * Once the exact live selection has been stable for FOLLOW_SETTLE_MS, retargets the follow pane,
   * or reopens follow view when it is wanted but its pane closed (archive, stop, delete, or startup).
   */
  private scheduleFollowRetarget(): void {
    const selected = this.controller.selected();
    const live = selected && this.selectedSessionTarget === selected.id && selected.status !== "stopped" && selected.status !== "error" ? selected : undefined;
    if (live?.id !== this.followRefused) this.followRefused = undefined;
    const pins = this.pinState();
    const retarget = this.actions.retargetFollow;
    const follow = this.actions.followSidePane;
    const target = !live ? undefined
      : this.followView() ? (retarget && !pins.hidden ? `retarget:${live.id}` : undefined)
      : this.followWanted && follow && !this.followRefused && !this.busy && !this.conversationOpen
        && !pins.slots.some(Boolean) && pins.capacity > 0 ? `follow:${live.id}` : undefined;
    if (target === this.followTarget) return;
    this.cancelFollowSchedule();
    this.followTarget = target;
    if (!target || !live) return;
    const sessionId = live.id;
    this.followTimer = setTimeout(() => {
      this.followTimer = undefined;
      if (target.startsWith("retarget:")) {
        void Promise.resolve(retarget!(sessionId)).catch((error) => { this.message = errorMessage(error); this.actions.requestRender?.(); });
        return;
      }
      void Promise.resolve(follow!(sessionId)).then(
        (result) => { if (result.kind === "refused") this.followRefused = sessionId; },
        (error) => { this.followRefused = sessionId; this.message = errorMessage(error); },
      ).finally(() => this.actions.requestRender?.());
    }, FOLLOW_SETTLE_MS);
  }

  private cancelFollowSchedule(): void {
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = undefined;
    this.followTarget = undefined;
  }

  private toggleFollowDefault() {
    const preference = this.actions.followPreference;
    if (!preference) {
      this.message = "follow default setting unavailable";
      return;
    }
    const next = !preference.followDefault();
    this.runAction(
      () => preference.setFollowDefault(next),
      "saving follow default...",
      () => {
        this.followWanted = next;
        this.flashMessage(`follow view by default ${glyphs.pendingStep} ${next ? "On" : "Off"}`);
      },
    );
  }

  private toggleFollow(sessionId: string | undefined) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const following = this.followView();
    const follow = this.actions.followSidePane;
    const unfollow = this.actions.unfollowSidePane;
    if (!follow || !unfollow || (!following && !sessionId)) {
      this.message = "follow view unavailable";
      return;
    }
    if (!following) this.closeConversation();
    this.followWanted = !following;
    this.cancelFollowSchedule();
    const pending = following ? "leaving follow view..." : "opening follow view...";
    runSyncAsyncAction<FollowSidePaneResult | CloseSidePaneResult>(() => following ? unfollow() : follow(sessionId!), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result) => {
        if (result.kind === "refused") this.flashMessage(result.reason);
        else if (result.kind === "unavailable") this.flashMessage("follow view is already closed");
      },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private focusFollow(sessionId: string) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const focus = this.actions.focusFollow;
    if (!focus) {
      this.message = "follow focus unavailable";
      return;
    }
    runSyncAsyncAction(() => focus(sessionId), {
      pending: "focusing follow pane...",
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === "focusing follow pane...") this.message = message; },
      // A hidden follow pane cannot take the keyboard; open the session full screen instead.
      success: (result) => {
        const session = this.controller.snapshot().sessions.find((item) => item.id === sessionId);
        if (result.kind === "unavailable" && session) this.acknowledgeAndAttach(sessionId, questionRequestId(session));
      },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private focusSidePaneSlot(slot: 1 | 2 | 3 | 4) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const focus = this.actions.focusSidePaneSlot;
    if (!focus) {
      this.message = "slot focus unavailable";
      return;
    }
    const pending = `focusing slot ${slot}...`;
    runSyncAsyncAction(() => focus(slot), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result) => { if (result.kind === "unavailable") this.flashMessage(`slot ${slot} is empty`); },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private closeSidePane(sessionId: string) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    const close = this.actions.closeSidePane;
    const title = this.controller.snapshot().sessions.find((item) => item.id === sessionId)?.title ?? sessionId;
    if (!close) {
      this.message = "close pin transport unavailable";
      return;
    }
    const pending = `closing ${title}...`;
    runSyncAsyncAction(() => close(sessionId), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result: CloseSidePaneResult) => this.flashMessage(result.kind === "closed" ? `pin closed ${glyphs.pendingStep} ${title}` : `${title} is not pinned`),
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private resizeSidePane(delta: -1 | 1) {
    const resize = this.actions.resizeSidePane;
    if (!resize) {
      this.message = "resize transport unavailable";
      return;
    }
    const pending = "resizing pins...";
    runSyncAsyncAction(() => resize(delta), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result: ResizeSidePaneResult) => this.flashMessage(result.kind === "resized" ? `pin split ${glyphs.pendingStep} ${result.splitPercent}%` : "pin layout cannot be resized"),
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  private focusSidePaneDirection(direction: "left" | "right") {
    const focus = this.actions.focusSidePaneDirection;
    if (!focus) return;
    this.runAction(() => focus(direction), "moving between pins...", () => {});
  }

  private returnToCockpit() {
    const returnToCockpit = this.actions.returnToCockpit;
    if (!returnToCockpit) return;
    const pending = "returning to cockpit...";
    runSyncAsyncAction(() => returnToCockpit(), {
      pending,
      setBusy: (busy) => { this.busy = busy; },
      setMessage: (message) => { if (!message || this.message === pending) this.message = message; },
      success: (result) => {
        if (result.kind === "focused") this.completeAttentionReturn();
      },
      failure: (error) => { this.message = errorMessage(error); },
    });
  }

  completeFullScreenReturn(key: "ctrl-q"): void {
    if (key === "ctrl-q") this.completeAttentionReturn();
  }

  private completeAttentionReturn(): void {
    const next = completeAttentionTrip(this.cockpitOnboarding);
    if (next === this.cockpitOnboarding) return;
    this.cockpitOnboarding = next;
    this.saveViewState();
    this.flashMessage("first attention round-trip complete");
  }

  private handleFleetMouse(event: MouseEvent) {
    if (this.pendingRestart) {
      this.lastMouseClick = undefined;
      if (event.kind === "press") this.clearPendingRestart();
      return;
    }
    if (event.kind === "wheel") {
      this.lastMouseClick = undefined;
      if (!this.workspaceSessionId) this.moveSelection(event.delta);
      return;
    }
    const footerItem = event.kind === "press" && event.y - 1 === this.footerRow
      ? this.footerItems.find((item) => event.x >= item.x && event.x < item.x + item.width)
      : undefined;
    if (footerItem) {
      // A footer tap is the same input as its key, so every availability guard still applies.
      this.lastMouseClick = undefined;
      this.handleInput(footerItem.key === "Enter" ? "\r" : footerItem.key === "Esc" ? "\u001b" : footerItem.key);
      return;
    }
    const announcementTarget = event.kind === "press" ? this.announcementRowTargets[event.y - 1] : undefined;
    if (announcementTarget) {
      this.lastMouseClick = undefined;
      this.executeDashboardCommand(announcementTarget);
      return;
    }
    const tierChip = event.kind === "press" && event.y - 1 === this.tierChipRow
      ? this.tierChips.find((chip) => event.x >= chip.x && event.x < chip.x + chip.width)
      : undefined;
    if (tierChip) {
      this.lastMouseClick = undefined;
      this.jumpToCockpitTier(tierChip.tier);
      return;
    }
    const cardHit = this.cardCommandHits.find(hit => hit.row === event.y - 1 && event.x >= hit.x && event.x < hit.x + hit.width);
    if (cardHit) {
      this.lastMouseClick = undefined;
      this.executeDashboardCommand(cardHit.commandId);
      return;
    }
    const workspaceTarget = this.workspaceStartX !== undefined && event.x >= this.workspaceStartX && event.x < this.lastWidth
      ? this.workspaceRowTargets[event.y - 1]
      : undefined;
    if (workspaceTarget) {
      this.lastMouseClick = undefined;
      this.executeDashboardCommand(workspaceTarget);
      return;
    }
    const inList = event.x >= this.listStartX && event.x < this.listStartX + this.listWidth;
    const target = inList ? this.rowTargets[event.y - 1] : undefined;
    if (!target) {
      this.lastMouseClick = undefined;
      return;
    }
    if ((target.kind === "session" || target.kind === "session-continuation") && target.id !== this.revealedSessionId) {
      this.revealedSessionId = undefined;
    }
    if (!this.selectListTarget(target)) {
      this.lastMouseClick = undefined;
      return;
    }
    const targetKey = target.kind === "release-cue" ? target.kind : target.kind === "archive-disclosure" ? target.kind : target.kind === "section-header" ? `section:${target.section}` : target.kind === "repo-header" ? `repo:${target.repoKey}` : `session:${target.id}`;
    const now = this.actions.now?.() ?? Date.now();
    const elapsed = this.lastMouseClick ? now - this.lastMouseClick.at : undefined;
    const doubleClick = this.lastMouseClick?.target === targetKey && elapsed !== undefined && elapsed >= 0 && elapsed <= DOUBLE_CLICK_MS;
    this.lastMouseClick = doubleClick ? undefined : { target: targetKey, at: now };
    if (doubleClick) {
      if (target.kind === "release-cue") this.dismissReleaseCue();
      else if (target.kind === "archive-disclosure") this.toggleArchiveDisclosure();
      else if (target.kind === "section-header") this.toggleSection(target.section);
      else if (target.kind === "repo-header") this.toggleRepo(target.repoKey);
      else this.activateFleetSelection();
    }
  }

  private jumpToCockpitTier(tier: CockpitTier): void {
    if (this.grouping !== "project" || this.fleetGrouping !== "status") return;
    const projection = this.dashboardProjection(this.controller.snapshot());
    const ownerId = projection.cockpitNavigation.find((entry) => entry.tier === tier)?.firstOwnerId;
    if (!ownerId) return;
    this.revealedSessionId = undefined;
    this.releaseCueSelected = false;
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    const sections = this.controller.snapshot().filter?.trim() ? this.filterDisclosure.sections : this.collapsedSections;
    if (!alwaysExpanded(tier) && sections.delete(tier)) {
      this.viewStateRevision += 1;
      this.saveViewState();
    }
    this.controller.selectSession(ownerId);
    this.listScrollTop = 0;
  }

  private toggleAttentionBell() {
    const setAttentionBell = this.actions.attentionDelivery?.setAttentionBell;
    if (!setAttentionBell) {
      this.message = "attention bell setting unavailable";
      return;
    }
    const next = !(this.actions.attentionDelivery?.attentionBellEnabled?.() ?? false);
    this.runAction(
      () => setAttentionBell(next),
      "saving attention bell...",
      () => this.flashMessage(`attention bell ${glyphs.pendingStep} ${next ? "On" : "Off"}`),
    );
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
      this.themeLoading = true;
      this.message = `loading themes... ${glyphs.pendingStep} Esc Cancel`;
      void result.then((input) => {
        if (request !== this.themeLoadRequest) return;
        this.busy = false;
        this.themeLoading = false;
        this.message = undefined;
        this.dialog = createThemeDialog(input);
      }).catch((error: unknown) => {
        if (request !== this.themeLoadRequest) return;
        this.busy = false;
        this.themeLoading = false;
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

  private activateFleetSelection(): void {
    const command = commandForKey(this.dashboardCommands(), "\r");
    if (command) this.executeDashboardCommand(command.id);
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
    const requestId = questionRequestId(selected);
    const focusPinned = this.actions.focusPinnedSession;
    // While following, Open means full screen; Enter already types into the follow pane.
    if (requestId && focusPinned && !this.followView()) {
      runSyncAsyncAction(() => focusPinned(selected.id), {
        pending: "locating questionnaire...",
        setBusy: (busy) => { this.busy = busy; },
        setMessage: (message) => { if (!message || this.message === "locating questionnaire...") this.message = message; },
        success: (result) => {
          if (result.kind === "focused" && this.currentQuestionRequestId(selected.id) === requestId) {
            this.startAttentionReturnTrip(selected.id, requestId);
          } else if (result.kind === "unavailable") this.acknowledgeAndAttach(selected.id, requestId);
        },
        failure: (error) => { this.message = errorMessage(error); },
      });
      return;
    }
    this.acknowledgeAndAttach(selected.id, requestId);
  }

  private acknowledgeAndAttach(sessionId: string, expectedRequestId?: string) {
    const selected = this.controller.snapshot().sessions.find((session) => session.id === sessionId);
    if (!selected) {
      this.message = "session is no longer available";
      return;
    }
    if (selected.status === "stopped" || selected.status === "error") {
      if (this.actions.restart) this.runAction(() => this.actions.restart?.(selected.id), "starting session...");
      else this.message = `session ${selected.status}; press r twice to restart`;
      return;
    }
    const currentRequestId = questionRequestId(selected);
    const tripRequestId = expectedRequestId && currentRequestId === expectedRequestId ? expectedRequestId : undefined;
    const activeRequest = this.activeAttentionAnnouncements().find((announcement) => announcement.sessionId === selected.id);
    const currentAttentionRequestId = selected.context?.attention?.requestId;
    const attach = () => {
      const current = this.controller.snapshot().sessions.find((session) => session.id === sessionId);
      if (!current) {
        this.message = "session is no longer available";
        return;
      }
      const result = this.attachSession(current);
      this.afterSuccessfulHandoff(result, tripRequestId ? { sessionId, requestId: tripRequestId } : undefined);
    };
    if (selected.status === "waiting" || activeRequest || currentAttentionRequestId) {
      try {
        const result = this.acknowledgeSession(selected.id, tripRequestId ?? currentAttentionRequestId ?? activeRequest?.requestId);
        if (isPromise(result)) {
          this.busy = true;
          this.message = "marking read...";
          void result.then(() => {
            this.busy = false;
            if (this.message === "marking read...") this.message = undefined;
            attach();
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
    attach();
  }

  private currentQuestionRequestId(sessionId: string): string | undefined {
    const session = this.controller.snapshot().sessions.find((item) => item.id === sessionId);
    return session ? questionRequestId(session) : undefined;
  }

  private startAttentionReturnTrip(sessionId: string, requestId: string): void {
    const next = startAttentionTrip(this.cockpitOnboarding, { sessionId, requestId });
    if (next === this.cockpitOnboarding) return;
    this.cockpitOnboarding = next;
    this.saveViewState();
  }

  private afterSuccessfulHandoff(
    result: boolean | Promise<boolean>,
    request: { sessionId: string; requestId: string } | undefined,
  ): void {
    if (!request || !process.env.TMUX) return;
    if (isPromise<boolean>(result)) {
      void result.then((success) => {
        if (success) this.startAttentionReturnTrip(request.sessionId, request.requestId);
      });
    } else if (result) this.startAttentionReturnTrip(request.sessionId, request.requestId);
  }

  private acknowledgeSession(sessionId: string, requestId?: string): unknown {
    if (this.actions.acknowledgeSession) return this.actions.acknowledgeSession(sessionId, requestId);
    if (this.actions.acknowledge) return this.actions.acknowledge();
    return this.controller.acknowledgeSession(sessionId, undefined, requestId);
  }

  private attachSession(selected: ManagedSession): boolean | Promise<boolean> {
    const plan = attachPlan(selected);
    if (plan.type === "inside-tmux") {
      const switchInsideTmux = this.actions.switchInsideTmux;
      if (!switchInsideTmux) {
        this.message = plan.message;
        return false;
      }
      this.flashMessage(`switching: ${plan.command} ${glyphs.pendingStep} Ctrl+Q Return`);
      try {
        const result = switchInsideTmux(selected.tmuxSession);
        if (isPromise(result)) return result.then((switched) => switched !== false).catch((error: unknown) => {
          this.message = `switch failed: ${errorMessage(error)}`;
          return false;
        });
        return result !== false;
      } catch (error) {
        this.message = `switch failed: ${errorMessage(error)}`;
        return false;
      }
    }
    try {
      const result = this.actions.attachOutsideTmux?.(selected.tmuxSession);
      if (isPromise(result)) return result.then(() => true).catch((error: unknown) => {
        this.message = `attach failed: ${errorMessage(error)}`;
        return false;
      });
      return true;
    } catch (error) {
      this.message = `attach failed: ${errorMessage(error)}`;
      return false;
    }
  }

  private releaseCueAvailable(): boolean {
    return this.releaseCueEnabled
      && this.grouping === "project"
      && this.fleetGrouping === "status"
      && !this.pinMode()
      && !this.controller.snapshot().filter?.trim()
      && !this.workspaceSessionId
      && releaseCueVisible(this.cockpitOnboarding, this.dismissedReleaseCueId);
  }

  private dismissReleaseCue(): void {
    if (!this.releaseCueAvailable()) return;
    this.dismissedReleaseCueId = COCKPIT_RELEASE_CUE.id;
    this.releaseCueSelected = false;
    this.saveViewState();
    this.normalizeListSelection();
    this.flashMessage("daily loop guidance dismissed");
  }

  private moveSelection(delta: number) {
    this.revealedSessionId = undefined;
    const targets = this.visibleListTargets();
    if (!targets.length) return;
    const previousId = this.controller.snapshot().selectedId;
    const index = Math.max(0, targets.findIndex((target) => target.kind === "release-cue"
      ? this.releaseCueSelected
      : target.kind === "archive-disclosure"
        ? this.archiveDisclosureSelected
        : target.kind === "section-header"
          ? this.selectedSection === target.section
          : target.kind === "repo-header"
            ? this.selectedRepo === target.repoKey
            : !this.releaseCueSelected && !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo && target.id === previousId));
    const next = targets[(index + delta + targets.length) % targets.length];
    if (next) this.selectListTarget(next);
  }

  private selectListTarget(next: SessionListTarget): boolean {
    if ((next.kind === "session" || next.kind === "session-continuation") && !this.controller.selectSession(next.id)) return false;
    this.initialSelectionPending = false;
    this.releaseCueSelected = next.kind === "release-cue";
    this.archiveDisclosureSelected = next.kind === "archive-disclosure";
    this.selectedSection = next.kind === "section-header" ? next.section : undefined;
    this.selectedRepo = next.kind === "repo-header" ? next.repoKey : undefined;
    return true;
  }

  private visibleListTargets(): SessionListTarget[] {
    if (this.grouping === "stage") return this.boardRows().map((row) => ({ kind: "session", id: row.id }));
    const projection = this.dashboardProjection(this.controller.snapshot());
    if (this.fleetGrouping === "repo") {
      const targets: SessionListTarget[] = [];
      for (const repo of projection.repoSections) {
        targets.push({ kind: "repo-header", repoKey: repo.key });
        if (!repo.collapsed) targets.push(...repo.rows.map((row) => ({ kind: "session" as const, id: row.id })));
      }
      const archived = projection.visible.filter((row) => projection.cockpitTierById.get(row.id) === "archived");
      const allArchived = projection.allRows.some((row) => projection.cockpitTierById.get(row.id) === "archived");
      if (allArchived) {
        targets.push({ kind: "section-header", section: "archived" });
        targets.push(...archived.map((row) => ({ kind: "session" as const, id: row.id })));
        if (projection.archiveDisclosureVisible) targets.push({ kind: "archive-disclosure" });
      }
      return targets;
    }
    const { allRows, visible: visibleRows } = projection;
    const tierOrder: CockpitTier[] = ["needs-you", "health", "new", "active", "quiet", "archived"];
    const targets: SessionListTarget[] = [];
    let releaseCueTargetAdded = false;
    for (const tier of tierOrder) {
      const allTierRows = allRows.filter((row) => projection.cockpitTierById.get(row.id) === tier);
      if (!allTierRows.length) continue;
      if (!alwaysExpanded(tier)) targets.push({ kind: "section-header", section: tier });
      const rows = visibleRows.filter((row) => projection.cockpitTierById.get(row.id) === tier);
      targets.push(...rows.map((row) => ({ kind: "session" as const, id: row.id })));
      if (tier === "needs-you" && this.releaseCueAvailable()) {
        targets.push({ kind: "release-cue" });
        releaseCueTargetAdded = true;
      }
      if (tier === "archived" && projection.archiveDisclosureVisible) targets.push({ kind: "archive-disclosure" });
    }
    if (this.releaseCueAvailable() && !releaseCueTargetAdded) targets.unshift({ kind: "release-cue" });
    return targets;
  }

  private normalizeListSelection() {
    const targets = this.visibleListTargets();
    if (!targets.length) {
      this.releaseCueSelected = false;
      this.archiveDisclosureSelected = false;
      this.selectedSection = undefined;
      this.selectedRepo = undefined;
      return;
    }
    if (this.releaseCueSelected) {
      if (targets.some((target) => target.kind === "release-cue")) return;
      this.releaseCueSelected = false;
    }
    if (this.archiveDisclosureSelected) {
      if (targets.some((target) => target.kind === "archive-disclosure")) return;
      this.archiveDisclosureSelected = false;
    }
    if (this.selectedSection && targets.some((target) => target.kind === "section-header" && target.section === this.selectedSection)) return;
    this.selectedSection = undefined;
    if (this.selectedRepo && targets.some((target) => target.kind === "repo-header" && target.repoKey === this.selectedRepo)) return;
    this.selectedRepo = undefined;
    const selectedId = this.controller.snapshot().selectedId;
    if (targets.some((target) => target.kind === "session" && target.id === selectedId)) return;
    const snapshot = this.controller.snapshot();
    const projection = this.dashboardProjection(snapshot, undefined);
    const { allRows, allTree: tree } = projection;
    const selectedRow = allRows.find((row) => row.id === selectedId);
    if (selectedRow && !snapshot.filter?.trim()) {
      const tier = projection.cockpitTierById.get(selectedRow.id);
      if (this.grouping === "project" && this.fleetGrouping === "repo" && tier !== "archived") {
        const ownerId = projection.cockpitOwnerById.get(selectedRow.id);
        const repoKey = ownerId ? projection.repoIdentityByOwnerId.get(ownerId)?.key : undefined;
        if (repoKey && this.collapsedRepos.has(repoKey)) {
          this.selectedRepo = repoKey;
          return;
        }
      }
      if (this.grouping === "project" && (this.fleetGrouping === "status" || tier === "archived")
        && tier && !alwaysExpanded(tier) && this.collapsedSections.has(tier)) {
        this.selectedSection = tier;
        return;
      }
    }
    const boardParentId = this.topLevelBoardParentId(selectedId);
    if (boardParentId && targets.some((target) => target.kind === "session" && target.id === boardParentId)) {
      this.controller.selectSession(boardParentId);
      return;
    }
    const fallback = [...targets].reverse().find((target) => target.kind === "session") ?? targets[0];
    if (fallback) this.selectListTarget(fallback);
  }

  private toggleArchiveDisclosure() {
    this.revealedSessionId = undefined;
    this.archiveExpanded = !this.archiveExpanded;
    this.viewStateRevision += 1;
    this.normalizeListSelection();
  }

  private toggleSection(section: CollapsibleSection) {
    this.revealedSessionId = undefined;
    const sections = this.controller.snapshot().filter?.trim() ? this.filterDisclosure.sections : this.collapsedSections;
    if (sections.has(section)) sections.delete(section);
    else sections.add(section);
    this.viewStateRevision += 1;
    this.saveViewState();
    this.normalizeListSelection();
  }

  private toggleRepo(repoKey: string) {
    this.revealedSessionId = undefined;
    const repos = this.controller.snapshot().filter?.trim() ? this.filterDisclosure.repos : this.collapsedRepos;
    if (repos.has(repoKey)) repos.delete(repoKey);
    else repos.add(repoKey);
    this.viewStateRevision += 1;
    this.normalizeListSelection();
  }

  private boardRows() {
    return this.dashboardProjection(this.controller.snapshot()).boardProjection.rows;
  }

  private dashboardProjection(snapshot: ReturnType<SessionsController["snapshot"]>, filterOverride?: string): DashboardProjection {
    const filter = filterOverride === undefined ? snapshot.filter?.trim() || undefined : filterOverride;
    const key = `${this.grouping}|${this.fleetGrouping}|${this.archiveExpanded}|${snapshot.sessions.length}|${this.viewStateRevision}|${filter ?? ""}|${this.revealedSessionId ?? ""}|${[...this.collapsedSections].join(",")}|${[...this.collapsedRepos].join(",")}|${[...this.expandedBoardParentIds].join(",")}|${[...this.expandedProjectParentIds].join(",")}`;
    if (this.projection && this.projectionRegistry === snapshot.registry && this.projectionKey === key) return this.projection;
    this.projection = buildDashboardProjection({ sessions: snapshot.sessions, filter, grouping: this.grouping,
      filterDisclosure: this.filterDisclosure,
      fleetGrouping: this.fleetGrouping,
      archiveExpanded: this.archiveExpanded, collapsedSections: this.collapsedSections, collapsedRepos: this.collapsedRepos,
      selectedRepo: this.selectedRepo,
      expandedBoardParentIds: this.expandedBoardParentIds, expandedProjectParentIds: this.expandedProjectParentIds,
      revealedSessionId: this.revealedSessionId });
    const repoKeys = new Set([...this.projection.repoIdentityByOwnerId.values()].map((identity) => identity.key));
    for (const repoKey of this.collapsedRepos) if (!repoKeys.has(repoKey)) this.collapsedRepos.delete(repoKey);
    this.projectionRegistry = snapshot.registry;
    this.projectionKey = key;
    return this.projection;
  }

  private topLevelBoardParentId(sessionId: string | undefined): string | undefined {
    if (!sessionId) return undefined;
    const projection = this.dashboardProjection(this.controller.snapshot(), undefined);
    const session = projection.allTree.get(sessionId);
    if (!session) return undefined;
    const trace = projection.allTree.trace(session);
    return (trace.owner ?? trace.terminal).id;
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
    if (this.controller.snapshot().filter?.trim()) {
      const collapsed = this.grouping === "stage" ? this.filterDisclosure.boardTrees : this.filterDisclosure.projectTrees;
      if (expanded) collapsed.delete(parentId);
      else collapsed.add(parentId);
    } else if (expanded) expandedIds.add(parentId);
    else expandedIds.delete(parentId);
    if (!expanded && selectedId !== parentId) this.controller.selectSession(parentId);
    this.viewStateRevision += 1;
    this.listScrollTop = 0;
  }

  private setAllSubagents(expanded: boolean) {
    this.revealedSessionId = undefined;
    const expandedIds = this.grouping === "stage" ? this.expandedBoardParentIds : this.expandedProjectParentIds;
    if (this.controller.snapshot().filter?.trim()) {
      const collapsed = this.grouping === "stage" ? this.filterDisclosure.boardTrees : this.filterDisclosure.projectTrees;
      if (expanded) collapsed.clear();
      else for (const parentId of this.subagentParentIds()) collapsed.add(parentId);
    } else if (expanded) {
      for (const parentId of this.subagentParentIds()) expandedIds.add(parentId);
    } else expandedIds.clear();
    this.viewStateRevision += 1;
    if (!expanded) {
      const selectedId = this.controller.snapshot().selectedId;
      const parentId = this.topLevelBoardParentId(selectedId);
      if (parentId && selectedId !== parentId) this.controller.selectSession(parentId);
    }
    this.listScrollTop = 0;
  }

  private toggleBoardSubagents() {
    const parentId = this.topLevelBoardParentId(this.controller.snapshot().selectedId);
    if (!parentId || !this.subagentParentIds().has(parentId)) return;
    this.setSelectedSubagents(this.controller.snapshot().filter?.trim()
      ? this.filterDisclosure.boardTrees.has(parentId)
      : !this.expandedBoardParentIds.has(parentId));
  }

  private saveViewState() {
    const state: SessionsViewState = { grouping: this.grouping };
    if (this.fleetGrouping === "repo") state.fleetGrouping = "repo";
    const filter = this.controller.snapshot().filter;
    if (filter !== undefined) state.filter = dashboardFilterState(parseDashboardFilter(filter));
    if (this.collapsedSections.size) state.collapsedSections = [...this.collapsedSections];
    if (this.cockpitOnboarding) state.cockpitOnboarding = this.cockpitOnboarding;
    if (this.dismissedReleaseCueId) state.dismissedReleaseCueId = this.dismissedReleaseCueId;
    this.actions.saveViewState?.(state);
  }

  private toggleGrouping() {
    const previousId = this.controller.snapshot().selectedId;
    const exactSelection = !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo && !this.releaseCueSelected;
    const ownerId = exactSelection ? this.topLevelBoardParentId(previousId) : undefined;
    this.revealedSessionId = exactSelection ? previousId : undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.grouping = this.grouping === "project" ? "stage" : "project";
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.selectedRepo = undefined;
    this.releaseCueSelected = false;
    if (ownerId && ownerId !== previousId) {
      (this.grouping === "stage" ? this.expandedBoardParentIds : this.expandedProjectParentIds).add(ownerId);
    }
    this.viewStateRevision += 1;
    this.saveViewState();
    if (this.grouping !== "stage") {
      this.normalizeListSelection();
      return;
    }
    const rows = this.boardRows();
    if (rows.length && !rows.some((row) => row.id === previousId)) {
      const parentId = this.topLevelBoardParentId(previousId);
      const nextId = rows.find((row) => row.id === parentId)?.id ?? rows[0]?.id ?? "";
      this.controller.selectSession(nextId);
    }
  }

  private toggleFleetGrouping() {
    if (this.grouping === "stage") {
      this.message = "return to the fleet first";
      return;
    }
    const selectedId = this.controller.snapshot().selectedId;
    const exactSelection = !this.archiveDisclosureSelected && !this.selectedSection && !this.selectedRepo && !this.releaseCueSelected;
    this.revealedSessionId = exactSelection ? selectedId : undefined;
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    this.fleetGrouping = this.fleetGrouping === "status" ? "repo" : "status";
    this.releaseCueSelected = false;
    this.archiveDisclosureSelected = false;
    this.selectedSection = undefined;
    this.selectedRepo = undefined;
    this.viewStateRevision += 1;
    this.saveViewState();
    this.normalizeListSelection();
  }

  private reorderSelected(delta: -1 | 1) {
    this.clearPendingRestart();
    this.clearFlash();
    this.message = undefined;
    if (this.grouping === "stage") {
      this.message = "switch to project grouping to reorder";
      return;
    }
    if (this.fleetGrouping === "repo") {
      this.message = "switch to Status grouping to reorder";
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

  private backlogSelected() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows follow their parent section";
      return;
    }
    this.clearPendingRestart();
    this.clearFlash();
    this.runAction(() => this.actions.backlogSession ? this.actions.backlogSession(selected.id) : this.controller.moveSessionToBucket(selected.id, "backlog"), "moving to backlog...");
  }

  private restoreSelectedBucket() {
    const selected = this.controller.selected();
    if (!selected) return;
    if (selected.kind === "subagent") {
      this.message = "subagent rows follow their parent section";
      return;
    }
    if (!selected.bucket && !selected.closure) {
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
    this.confirmationReview = undefined;
    this.pendingRestart = createRestartDialog(selected.id);
    this.message = undefined;
  }

  private confirmRestartSelected(newConversation: boolean) {
    const selected = this.controller.snapshot().registry.sessions.find((session) => session.id === this.pendingRestart?.targetId);
    if (!selected || selected.kind === "subagent") { this.clearPendingRestart(); this.message = "restart target is no longer available"; return; }
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
    if (hadPendingRestart) this.message = undefined;
  }

  // The request-bound command ID already rejects stale targets before this runs.
  private copyHandoffPath(sessionId: string): void {
    const artifact = this.controller.snapshot().sessions.find((session) => session.id === sessionId)?.context?.attention?.artifact;
    if (!artifact) return;
    this.actions.copy?.(artifact);
    this.flashMessage("Copied path");
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

  private runAction(action: () => unknown, pendingMessage: string, onSuccess?: (result: unknown) => void): void {
    try {
      const result = action();
      if (!isPromise(result)) {
        onSuccess?.(result);
        return;
      }
      this.busy = true;
      this.message = pendingMessage;
      void result.then((value) => {
        this.busy = false;
        onSuccess?.(value);
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

function questionRequestId(session: RuntimeSession): string | undefined {
  const attention = session.context?.attention;
  if ((session.status !== "waiting" && session.status !== "idle") || attention?.kind !== "question") return undefined;
  const requestId = attention.requestId;
  return typeof requestId === "string" && requestId.length > 0 && requestId.length <= 64 ? requestId : undefined;
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
  const palette = renderCommandPalette(state, commands, innerWidth, panelHeight, theme, undefined, false);
  const start = footerIndex - panelHeight;
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  for (let index = 0; index < panelHeight; index += 1) {
    const panelLine = palette.lines[index] ?? "";
    const padded = `${panelLine}${" ".repeat(Math.max(0, innerWidth - visibleWidth(panelLine)))}`;
    lines[start + index] = `${border(glyphs.vertical)}${padded}${border(glyphs.vertical)}`;
    rowTargets[start + index] = palette.rowTargets[index];
  }
  return { lines, rowTargets, bounds: { start, end: start + panelHeight - 1 } };
}

function spatialDirection(data: string): "left" | "right" | undefined {
  for (const direction of ["left", "right"] as const) {
    if (matchesKey(data, Key.alt(direction))) return direction;
  }
  return undefined;
}

function syncPiNameMessage(result: SyncPiNameResult): string {
  switch (result.status) {
    case "synced": return `renamed from Pi name: ${result.name}`;
    case "unavailable": return "Pi session file not available yet";
    case "unnamed": return "no Pi name set";
  }
}

function renderHelp(width: number, theme: SessionsTheme | undefined, shortcuts: readonly DashboardShortcut[] | undefined, height: number | undefined, scroll: number): { lines: string[]; offset: number; maxOffset: number; pageSize: number } {
  const heading = (text: string) => theme ? styleToken(theme, "accent", text) : text;
  const muted = (text: string) => theme ? styleToken(theme, "muted", text) : text;
  const inner = Math.max(MIN_RENDER_WIDTH, width) - 2;
  const sections = dashboardHelpSections(shortcuts);
  const sectionLines = (section: typeof sections[number], cells: number): string[] => {
    const keyWidth = Math.max(0, ...section.commands.map(command => visibleWidth(formatKey(command.displayKey ?? ""))));
    return [heading(section.label), ...(section.paletteNote ? [muted("  via : palette")] : []), ...section.commands.map(command => {
      const key = formatKey(command.displayKey ?? "");
      const labelWidth = cells - 4 - keyWidth;
      const label = truncateVisible(command.label, labelWidth);
      const hintWidth = labelWidth - visibleWidth(label) - 3;
      const hint = width >= 120 && hintWidth >= 12 ? muted(` ${glyphs.pendingStep} ${truncateVisible(command.hint, hintWidth)}`) : "";
      return `  ${padVisibleLine(`${label}${hint}`, labelWidth)}  ${" ".repeat(keyWidth - visibleWidth(key))}${heading(key)}`;
    })];
  };
  const commandLines: string[] = [];
  const columns = width >= 160 ? 2 : 1;
  const columnWidth = columns === 2 ? Math.floor((inner - 4) / 2) : inner;
  for (let index = 0; index < sections.length; index += columns) {
    const left = sectionLines(sections[index]!, columnWidth);
    const right = columns === 2 ? sectionLines(sections[index + 1]!, inner - columnWidth - 4) : [];
    for (let row = 0; row < Math.max(left.length, right.length); row += 1) {
      commandLines.push(columns === 2 ? `${padVisibleLine(left[row] ?? "", columnWidth)}    ${right[row] ?? ""}` : left[row]!);
    }
    commandLines.push("");
  }
  const referenceLines = [
    heading("Navigation"),
    `  ${glyphs.up}${glyphs.down}/j/k Move selection     Esc Cancel/clear`,
    "  P Pin/focus selected     x Close selected pin     +/- Resize split",
    `  Alt+${glyphs.left}/${glyphs.right} Move spatially     Ctrl+Q Return to cockpit`,
    `  subagent rows: ${glyphs.left}/${glyphs.right} Collapse/expand selected ${glyphs.pendingStep} Shift+${glyphs.left}/${glyphs.right} All`,
    `  mouse click select ${glyphs.pendingStep} header tier chips jump ${glyphs.pendingStep} double-click open/switch ${glyphs.pendingStep} wheel move`,
    "",
    heading("Choice dialogs"),
    "  Restart: r Selected     n New conversation     a All     Esc Cancel",
    "  Delete: d Delete/forget     D Discard worktree     s Close subagents     w Finish worktree",
    `  Group picker: Ctrl+N/Ctrl+P Cycle groups ${glyphs.pendingStep} palette: Ctrl+N/Ctrl+P Move selection`,
    "",
    heading("New-session form"),
    `  Tab/${glyphs.up}${glyphs.down} Move     Space Toggle Worktree row     Ctrl+T Toggle anywhere     Ctrl+O Choose repo`,
    "  Ctrl+R Add repo    Ctrl+X Remove extra",
    "",
    heading("Pickers and themes"),
    `  pickers: ${glyphs.left}${glyphs.right}/Tab Switch columns; theme: live preview, Enter Apply, Esc Cancel`,
    "",
    heading("Return from managed sessions and panels"),
    "  Ctrl+Q Return to cockpit     Alt+R Rename session     Alt+W Open next request",
    "",
    heading("Sections and views"),
    `  Status fleet: Needs you ${glyphs.pendingStep} Health ${glyphs.pendingStep} Active ${glyphs.pendingStep} Quiet; groups appear on session rows`,
    "  v Toggle flat repo sections; Enter/double-click Fold the selected repo header",
    "  only explicit producer attention enters Needs you; Backlog stays labeled in Quiet when inactive",
    "  Archived is flat and chronological; Enter/double-click Reveal older rows",
    "  Archived cascades auto-remove after 7d once every tmux session is gone",
    "  S Toggle the read-only producer workflow board",
    "  Board view lanes canonical workflow sessions by producer step, then OTHER ACTIVE;",
    "  subagent rows start collapsed; Space Toggle one board tree; filters reveal matches",
    "  every lane nests project/group labels; Backlog/Archived stay summarized",
    "",
    heading("Status legend"),
    `  ${glyphs.running} running (selected row animates)     ${glyphs.waiting} waiting     ${glyphs.idle} idle     ${glyphs.error} error     - stopped`,
    `  ${glyphs.worktree} active worktree     ${glyphs.worktreePending} awaits merge     ${glyphs.worktreeWarning} cleanup/check needed     ${glyphs.worktreeDone} cleanup verified`,
    "  zero counts are hidden from tier and top summaries",
    "",
    heading("Action workspace"),
    `  selected session: request ${glyphs.pendingStep} task ${glyphs.pendingStep} workflow position ${glyphs.pendingStep} exceptional guidance ${glyphs.pendingStep} actions`,
    `  ${glyphs.selected} marks the primary action; i Append or hide live Details`,
    "  Enter/double-click Open or switch directly at every width",
    "  with pins, Enter Open directly and i Toggle details in the compact decision strip",
  ];
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  const content = [...commandLines, ...(width <= NARROW_LAYOUT_MAX_WIDTH
    ? referenceLines.flatMap((line) => line ? wrapWords(stripAnsi(line), inner, inner) : [""])
    : referenceLines)];
  const pageSize = Math.max(1, (height ?? content.length + 4) - 4);
  const maxOffset = Math.max(0, content.length - pageSize);
  const offset = Math.max(0, Math.min(scroll, maxOffset));
  const body = [heading("pi agent hub help"), ...content.slice(offset, offset + pageSize), `${glyphs.up}${glyphs.down}/PgUp/PgDn Scroll ${glyphs.pendingStep} Esc Back`];
  const rendered = [
    border(`${glyphs.topLeft}${glyphs.horizontal.repeat(inner)}${glyphs.topRight}`),
    ...body.map((line) => `${border(glyphs.vertical)}${padVisibleLine(line, inner)}${border(glyphs.vertical)}`),
    border(`${glyphs.bottomLeft}${glyphs.horizontal.repeat(inner)}${glyphs.bottomRight}`),
  ];
  return { lines: height && height < 5 ? limitRows(["Help: enlarge pane", "Esc Back"], height, width, theme) : rendered, offset, maxOffset, pageSize };
}

function padVisibleLine(line: string, width: number): string {
  const text = truncateVisible(line, width);
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function limitRows(lines: string[], height: number | undefined, width: number, theme?: SessionsTheme): string[] {
  if (!height || height <= 0 || lines.length <= height) return lines;
  const marker = theme ? styleToken(theme, "muted", `${glyphs.ellipsis} resize for full help`) : `${glyphs.ellipsis} resize for full help`;
  return [...lines.slice(0, Math.max(0, height - 1)), truncateVisible(marker, Math.max(1, width))];
}

function narrowNotice(width: number): string[] {
  const safeWidth = Math.max(1, width);
  return [
    "pi agent hub",
    "pane too narrow",
    `widen to ${glyphs.atLeast}${MIN_RENDER_WIDTH} cols`,
  ].map((line) => truncateVisible(line, safeWidth));
}

function replaceFooter(lines: string[], message: string, theme?: SessionsTheme): string[] {
  if (!lines.length) return lines;
  const lastLine = stripAnsi(lines.at(-1) ?? "");
  if (!lastLine.startsWith(glyphs.bottomLeft)) {
    // Frameless phone layouts keep the footer on the last row.
    return [...lines.slice(0, -1), truncateVisible(message, Math.max(1, visibleWidth(lastLine)))];
  }
  if (lines.length < 3) return lines;
  const copy = lines.slice();
  const footerIndex = copy.length - 2;
  const width = stripAnsi(copy[footerIndex] ?? "").length;
  const inner = Math.max(0, width - 2);
  const border = (text: string) => theme ? styleToken(theme, "border", text) : text;
  const text = truncateVisible(message, inner);
  copy[footerIndex] = `${border(glyphs.vertical)}${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))}${border(glyphs.vertical)}`;
  return copy;
}

function truncateVisible(value: string, width: number): string {
  if (width <= 1) return "";
  return truncateToWidth(value, width, glyphs.ellipsis);
}
