import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import type { CloseSidePaneResult, FocusSidePaneResult, ResizeSidePaneResult, SidePaneResult, SidePaneSlot, SpatialDirection } from "../app/side-pane.js";
import type { DashboardShortcut } from "../core/dashboard-shortcuts.js";
import type { ManagedSession } from "../core/types.js";
import type { NewFormContext, NewFormSubmission } from "./new-form.js";
import type { PickerItem } from "./two-column-picker.js";
import type { SessionsTheme } from "./theme.js";
import type { PromptDialog } from "./prompt-dialog.js";
import type { FormDialog } from "./form-dialogs.js";
import type { ConfirmDialog } from "./confirm-dialogs.js";
import type { PickerDialog } from "./picker-dialog.js";
import type { NewSessionDialog, RepoPickerDialog } from "./new-session-dialog.js";
import type { ThemeDialog, ThemeDialogInput } from "./theme-dialog.js";
import type { CommandPaletteDialog } from "./command-palette-dialog.js";

export interface ForkDialogInput {
  group: string;
  compact?: boolean;
}

export type { CloseSidePaneResult, FocusSidePaneResult, ResizeSidePaneResult, SidePaneResult };

export type CollapsibleSection = "archived";

export interface SessionsViewState {
  grouping: "project" | "stage";
  collapsedSections?: CollapsibleSection[];
}

export interface SessionLifecycleActions {
  restart: (sessionId: string) => unknown;
  restartNew: (sessionId: string) => unknown;
  restartAll: () => unknown;
  deleteSession: (sessionId: string) => void | Promise<void>;
  closeSubagents: (sessionId: string) => void | Promise<void>;
  discardWorktree: (sessionId: string) => void | Promise<void>;
  finishWorktree: (sessionId: string) => void | Promise<void>;
  createSession: (input: NewFormSubmission) => unknown;
  forkSession: (sourceSessionId: string, input: ForkDialogInput) => unknown;
  changeGroup: (sessionId: string, group: string) => unknown;
  archiveSession: (sessionId: string) => unknown;
  backlogSession: (sessionId: string) => unknown;
  restoreSession: (sessionId: string) => unknown;
  renameSession: (sessionId: string, title: string) => unknown;
  syncPiName: (sessionId: string) => SyncPiNameResult | Promise<SyncPiNameResult>;
  renameGroup: (from: string, to: string) => unknown;
  reorderSelected: (delta: -1 | 1) => unknown;
  reorderSession: (sessionId: string, delta: -1 | 1) => unknown;
  acknowledge: () => unknown;
  acknowledgeSession: (sessionId: string, requestId?: string) => unknown;
}

export interface SidePaneViewState {
  slots: readonly (string | undefined)[];
  activeSessionId?: string;
  capacity: number;
  constrained: boolean;
  splitPercent: number;
}

export interface SidePaneActions {
  pinSidePane: (sessionId: string) => SidePaneResult | Promise<SidePaneResult>;
  assignSidePaneSlot: (sessionId: string, slot: SidePaneSlot) => SidePaneResult | Promise<SidePaneResult>;
  focusSidePaneSlot: (slot: SidePaneSlot) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  focusPinnedSession: (sessionId: string) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  closeSidePane: (sessionId: string) => CloseSidePaneResult | Promise<CloseSidePaneResult>;
  resizeSidePane: (delta: -1 | 1) => ResizeSidePaneResult | Promise<ResizeSidePaneResult>;
  focusSidePaneDirection: (direction: SpatialDirection) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  returnToCockpit: () => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  sidePaneState: () => SidePaneViewState;
}

export interface ProjectPickerTarget {
  sessionId?: string;
  projectCwd: string;
}

export interface SkillsActions {
  skills: (target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
  pickerTarget: () => ProjectPickerTarget;
  applySkills: (items: PickerItem[], target: ProjectPickerTarget) => void | Promise<void>;
  skillPoolDir: () => string | undefined;
  skillPoolDirExtraCount: () => number;
  saveSkillPoolDir: (dir: string, target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
}

export interface McpActions {
  mcpServers: (target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
  pickerTarget: () => ProjectPickerTarget;
  applyMcpServers: (items: PickerItem[], target: ProjectPickerTarget) => void | Promise<void>;
}

export interface ThemeActions {
  themeSettings: () => ThemeDialogInput | Promise<ThemeDialogInput>;
  previewDashboardTheme: (setting: string) => void;
  cancelDashboardTheme: (setting: string) => void;
  applyDashboardTheme: (setting: string, syncPi: boolean) => void | Promise<void>;
}

export interface NavigationActions {
  attachOutsideTmux: (tmuxSession: string) => void | Promise<void>;
  switchInsideTmux: (tmuxSession: string) => void | Promise<void>;
  sendMessage: (tmuxSession: string, message: string) => unknown;
  refreshStatusEvidence: () => void | Promise<void>;
}

export interface DashboardShortcutActions {
  dashboardShortcuts: readonly DashboardShortcut[];
  runDashboardShortcut: (sessionId: string, shortcut: DashboardShortcut) => unknown;
}

export interface AttentionDeliveryActions {
  attentionBellEnabled: () => boolean;
  setAttentionBell: (enabled: boolean) => void | Promise<void>;
}

/** Composition-bound action bag. Groups are optional; members are required when supplied. */
export interface SessionsViewActions {
  sessionLifecycle?: Partial<SessionLifecycleActions>;
  sidePane?: Partial<SidePaneActions>;
  skillActions?: Partial<SkillsActions>;
  mcpActions?: Partial<McpActions>;
  themeActions?: Partial<ThemeActions>;
  navigationActions?: Partial<NavigationActions>;
  shortcutActions?: Partial<DashboardShortcutActions>;
  attentionDelivery?: Partial<AttentionDeliveryActions>;

  initialViewState?: SessionsViewState;
  /** Legacy flat fields remain accepted at the SessionsView composition boundary. */
  saveViewState?: (state: SessionsViewState) => void;
  attachOutsideTmux?: (tmuxSession: string) => void | Promise<void>;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  pinSidePane?: (sessionId: string) => SidePaneResult | Promise<SidePaneResult>;
  assignSidePaneSlot?: (sessionId: string, slot: SidePaneSlot) => SidePaneResult | Promise<SidePaneResult>;
  focusSidePaneSlot?: (slot: SidePaneSlot) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  focusPinnedSession?: (sessionId: string) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  closeSidePane?: (sessionId: string) => CloseSidePaneResult | Promise<CloseSidePaneResult>;
  resizeSidePane?: (delta: -1 | 1) => ResizeSidePaneResult | Promise<ResizeSidePaneResult>;
  focusSidePaneDirection?: (direction: SpatialDirection) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  returnToCockpit?: () => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  sidePaneState?: () => SidePaneViewState;
  refreshStatusEvidence?: () => void | Promise<void>;
  restart?: (sessionId: string) => unknown;
  restartNew?: (sessionId: string) => unknown;
  restartAll?: () => unknown;
  deleteSession?: (sessionId: string) => void | Promise<void>;
  closeSubagents?: (sessionId: string) => void | Promise<void>;
  discardWorktree?: (sessionId: string) => void | Promise<void>;
  finishWorktree?: (sessionId: string) => void | Promise<void>;
  createSession?: (input: NewFormSubmission) => unknown;
  forkSession?: (sourceSessionId: string, input: ForkDialogInput) => unknown;
  changeGroup?: (sessionId: string, group: string) => unknown;
  archiveSession?: (sessionId: string) => unknown;
  backlogSession?: (sessionId: string) => unknown;
  restoreSession?: (sessionId: string) => unknown;
  renameSession?: (sessionId: string, title: string) => unknown;
  syncPiName?: (sessionId: string) => SyncPiNameResult | Promise<SyncPiNameResult>;
  renameGroup?: (from: string, to: string) => unknown;
  reorderSelected?: (delta: -1 | 1) => unknown;
  reorderSession?: (sessionId: string, delta: -1 | 1) => unknown;
  acknowledge?: () => unknown;
  acknowledgeSession?: (sessionId: string, requestId?: string) => unknown;
  newFormContext?: () => NewFormContext;
  skills?: (target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
  applySkills?: (items: PickerItem[], target: ProjectPickerTarget) => void | Promise<void>;
  skillPoolDir?: () => string | undefined;
  skillPoolDirExtraCount?: () => number;
  saveSkillPoolDir?: (dir: string, target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
  pickerTarget?: () => ProjectPickerTarget;
  mcpServers?: (target: ProjectPickerTarget) => PickerItem[] | Promise<PickerItem[]>;
  applyMcpServers?: (items: PickerItem[], target: ProjectPickerTarget) => void | Promise<void>;
  themeSettings?: () => ThemeDialogInput | Promise<ThemeDialogInput>;
  previewDashboardTheme?: (setting: string) => void;
  cancelDashboardTheme?: (setting: string) => void;
  applyDashboardTheme?: (setting: string, syncPi: boolean) => void | Promise<void>;
  sendMessage?: (tmuxSession: string, message: string) => unknown;
  dashboardShortcuts?: readonly DashboardShortcut[];
  runDashboardShortcut?: (sessionId: string, shortcut: DashboardShortcut) => unknown;
  copy?: (text: string) => void;
  now?: () => number;
  terminalRows?: () => number;
}

export type SessionDialog = { kind: "help" } | CommandPaletteDialog | PromptDialog | FormDialog | ConfirmDialog | PickerDialog | NewSessionDialog | RepoPickerDialog | ThemeDialog;

export interface DialogContext {
  controller: SessionsController;
  actions: SessionsViewActions;
  theme: SessionsTheme | undefined;
  now(): number;
  close(): void;
  setDialog(dialog: SessionDialog): void;
  dialog(): SessionDialog | undefined;
  setMessage(message: string | undefined): void;
  message(): string | undefined;
  flashMessage(text: string): void;
  runAction(action: () => unknown, pending: string, onSuccess?: () => void): void;
  attachSession(session: ManagedSession): void;
  stop(): void;
}

/** Context boundary for a dialog family. Only the declared action fields are visible. */
export type DialogContextFor<Actions extends object> = Omit<DialogContext, "actions"> & { actions: Actions };

export type PromptDialogContext = DialogContextFor<Partial<Pick<NavigationActions, "sendMessage">>>;
export type FormDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "forkSession" | "changeGroup" | "renameSession" | "renameGroup">>>;
export type ConfirmDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "deleteSession" | "closeSubagents" | "discardWorktree" | "finishWorktree" | "restart" | "restartNew" | "restartAll">>>;
export type PickerDialogContext = DialogContextFor<Partial<Pick<SkillsActions, "pickerTarget" | "skillPoolDir" | "skillPoolDirExtraCount" | "saveSkillPoolDir" | "applySkills">> & Partial<Pick<McpActions, "applyMcpServers">>>;
export type NewSessionDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "createSession">> & { newFormContext?: () => NewFormContext }>;
export type ThemeDialogContext = DialogContextFor<Partial<Pick<ThemeActions, "previewDashboardTheme" | "cancelDashboardTheme" | "applyDashboardTheme">>>;

export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
