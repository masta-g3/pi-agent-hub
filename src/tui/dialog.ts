import type { SessionsController, SyncPiNameResult } from "../app/controller.js";
import type { CloseSidePaneResult, FocusSidePaneResult, SidePaneResult } from "../app/side-pane.js";
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

export interface SessionDialogInput {
  cwd?: string;
  group: string;
  additionalCwds?: string[];
  worktree?: { branch: string };
}

/** Compatibility aliases. The result contracts are owned by app/side-pane. */
export type SidePaneActionResult = SidePaneResult;
export type { CloseSidePaneResult, FocusSidePaneResult, SidePaneResult };

export type CollapsibleSection = "backlog" | "archived";

export interface SessionsViewState {
  grouping: "project" | "stage";
  density: "compact" | "all-cards";
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
  forkSession: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => unknown;
  changeGroup: (sessionId: string, group: string) => unknown;
  archiveSession: (sessionId: string) => unknown;
  backlogSession: (sessionId: string) => unknown;
  restoreSession: (sessionId: string) => unknown;
  renameSession: (sessionId: string, title: string) => unknown;
  syncPiName: (sessionId: string) => SyncPiNameResult | Promise<SyncPiNameResult>;
  renameGroup: (from: string, to: string) => unknown;
  reorderSelected: (delta: -1 | 1) => unknown;
  acknowledge: () => unknown;
}

export interface SidePaneActions {
  assignSidePaneSlot: (sessionId: string, slot: 1 | 2 | 3 | 4) => SidePaneResult | Promise<SidePaneResult>;
  closeSidePaneSlot: (slot: 1 | 2 | 3 | 4) => CloseSidePaneResult | Promise<CloseSidePaneResult>;
  resetSidePane: (sessionId: string) => SidePaneResult | Promise<SidePaneResult>;
  focusSidePaneSlot: (slot: 1 | 2 | 3 | 4) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
}

export interface SkillsActions {
  skills: () => PickerItem[] | Promise<PickerItem[]>;
  applySkills: (items: PickerItem[]) => void | Promise<void>;
  skillPoolDir: () => string | undefined;
  skillPoolDirExtraCount: () => number;
  saveSkillPoolDir: (dir: string) => PickerItem[] | Promise<PickerItem[]>;
}

export interface McpActions {
  mcpServers: () => PickerItem[] | Promise<PickerItem[]>;
  applyMcpServers: (items: PickerItem[]) => void | Promise<void>;
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
  selectionChanged: () => void;
  refreshStatusEvidence: () => void | Promise<void>;
}

export interface DashboardShortcutActions {
  dashboardShortcuts: readonly DashboardShortcut[];
  runDashboardShortcut: (sessionId: string, shortcut: DashboardShortcut) => unknown;
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

  initialViewState?: SessionsViewState;
  /** Legacy flat fields remain accepted at the SessionsView composition boundary. */
  saveViewState?: (state: SessionsViewState) => void;
  attachOutsideTmux?: (tmuxSession: string) => void | Promise<void>;
  switchInsideTmux?: (tmuxSession: string) => void | Promise<void>;
  assignSidePaneSlot?: (sessionId: string, slot: 1 | 2 | 3 | 4) => SidePaneActionResult | Promise<SidePaneActionResult>;
  closeSidePaneSlot?: (slot: 1 | 2 | 3 | 4) => CloseSidePaneResult | Promise<CloseSidePaneResult>;
  resetSidePane?: (sessionId: string) => SidePaneActionResult | Promise<SidePaneActionResult>;
  focusSidePaneSlot?: (slot: 1 | 2 | 3 | 4) => FocusSidePaneResult | Promise<FocusSidePaneResult>;
  sidePaneSessionIds?: () => ReadonlyMap<string, number>;
  sidePaneFocusedSlot?: () => number | undefined;
  selectionChanged?: () => void;
  refreshStatusEvidence?: () => void | Promise<void>;
  restart?: (sessionId: string) => unknown;
  restartNew?: (sessionId: string) => unknown;
  restartAll?: () => unknown;
  deleteSession?: (sessionId: string) => void | Promise<void>;
  closeSubagents?: (sessionId: string) => void | Promise<void>;
  discardWorktree?: (sessionId: string) => void | Promise<void>;
  finishWorktree?: (sessionId: string) => void | Promise<void>;
  createSession?: (input: NewFormSubmission) => unknown;
  forkSession?: (sourceSessionId: string, input: Omit<SessionDialogInput, "cwd">) => unknown;
  changeGroup?: (sessionId: string, group: string) => unknown;
  archiveSession?: (sessionId: string) => unknown;
  backlogSession?: (sessionId: string) => unknown;
  restoreSession?: (sessionId: string) => unknown;
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
  themeSettings?: () => ThemeDialogInput | Promise<ThemeDialogInput>;
  previewDashboardTheme?: (setting: string) => void;
  cancelDashboardTheme?: (setting: string) => void;
  applyDashboardTheme?: (setting: string, syncPi: boolean) => void | Promise<void>;
  sendMessage?: (tmuxSession: string, message: string) => unknown;
  dashboardShortcuts?: readonly DashboardShortcut[];
  runDashboardShortcut?: (sessionId: string, shortcut: DashboardShortcut) => unknown;
  copy?: (text: string) => void;
  skillCount?: (cwd: string) => number | undefined;
  now?: () => number;
  terminalRows?: () => number;
}

export type SessionDialog = { kind: "help" } | PromptDialog | FormDialog | ConfirmDialog | PickerDialog | NewSessionDialog | RepoPickerDialog | ThemeDialog;

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

export type PromptDialogContext = DialogContextFor<Partial<Pick<NavigationActions, "sendMessage" | "selectionChanged">>>;
export type FormDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "forkSession" | "changeGroup" | "renameSession" | "renameGroup">>>;
export type ConfirmDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "deleteSession" | "closeSubagents" | "discardWorktree" | "finishWorktree" | "restart" | "restartNew" | "restartAll">>>;
export type PickerDialogContext = DialogContextFor<Partial<Pick<SkillsActions, "skillPoolDir" | "skillPoolDirExtraCount" | "saveSkillPoolDir" | "applySkills">> & Partial<Pick<McpActions, "applyMcpServers">>>;
export type NewSessionDialogContext = DialogContextFor<Partial<Pick<SessionLifecycleActions, "createSession">> & { newFormContext?: () => NewFormContext }>;
export type ThemeDialogContext = DialogContextFor<Partial<Pick<ThemeActions, "previewDashboardTheme" | "cancelDashboardTheme" | "applyDashboardTheme">>>;

export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
