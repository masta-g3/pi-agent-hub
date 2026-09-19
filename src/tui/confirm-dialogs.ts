import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sessionCascadeIds } from "../core/session-tree.js";
import { isWorktreeSession, primaryWorktree } from "../core/worktree.js";
import type { ManagedSession } from "../core/types.js";
import { errorMessage, isPromise, type ConfirmDialogContext } from "./dialog.js";
import { renderDialog } from "./layout.js";
import { styleToken, type SessionsTheme } from "./theme.js";

interface BoundedConfirmation {
  scroll: number;
  contentKey?: string;
  readThrough?: number;
}

export interface ConfirmationReview {
  targetId: string;
  targetKey: string;
  contentKey: string;
  start: number;
  end: number;
  total: number;
  pageSize: number;
  actionable: boolean;
}

export interface ConfirmationRender {
  lines: string[];
  review: ConfirmationReview;
}

export interface ConfirmDialog extends BoundedConfirmation {
  kind: "confirm";
  purpose: "delete" | "finish";
  targetId: string;
  busy: false | "session" | "subagents" | "worktree" | "finish";
}

export interface RestartDialog extends BoundedConfirmation {
  targetId: string;
}

export type RestartDialogResult = RestartDialog | "cancel" | "restart" | "new" | "all";

function confirmationState(): BoundedConfirmation {
  return { scroll: 0 };
}

export function createRestartDialog(targetId: string): RestartDialog {
  return { targetId, ...confirmationState() };
}

export function openDeleteDialog(ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  return { kind: "confirm", purpose: "delete", targetId: selected.id, busy: false, ...confirmationState() };
}

export function openFinishDialog(ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows cannot be finished");
    return undefined;
  }
  if (!isWorktreeSession(selected) || selected.worktreeOwnedByHub !== true) {
    ctx.setMessage("selected session is not a worktree");
    return undefined;
  }
  if (!ctx.actions.finishWorktree) {
    ctx.setMessage("finish worktree unavailable");
    return undefined;
  }
  return { kind: "confirm", purpose: "finish", targetId: selected.id, busy: false, ...confirmationState() };
}

export function handleConfirmInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext, review: ConfirmationReview | undefined): ConfirmDialog | undefined {
  if (dialog.busy) return dialog;
  if (matchesKey(data, Key.escape)) { ctx.setMessage(undefined); return undefined; }
  if (!review || review.targetId !== dialog.targetId) return dialog;
  const seen = readConfirmation(dialog, review);
  if (matchesKey(data, Key.pageUp)) return scrollConfirmation(seen, -review.pageSize);
  if (matchesKey(data, Key.pageDown)) return scrollConfirmation(seen, review.pageSize);
  if (!review.actionable || (seen.readThrough ?? 0) < review.total) return seen;
  if (dialog.purpose === "delete") return handleDeleteInput(seen, data, ctx, review.targetKey);
  return handleFinishInput(seen, data, ctx, review.targetKey);
}

export function handleRestartDialogInput(dialog: RestartDialog, data: string, ctx: ConfirmDialogContext, review: ConfirmationReview | undefined): RestartDialogResult {
  if (matchesKey(data, Key.escape)) return "cancel";
  if (!review || review.targetId !== dialog.targetId) return dialog;
  const seen = readConfirmation(dialog, review);
  if (matchesKey(data, Key.pageUp)) return scrollConfirmation(seen, -review.pageSize);
  if (matchesKey(data, Key.pageDown)) return scrollConfirmation(seen, review.pageSize);
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  if (!review.actionable || (seen.readThrough ?? 0) < review.total || !target || target.kind === "subagent"
    || review.targetKey !== targetReviewKey(target, [])) return seen;
  if (data === "r" || data === "R") return "restart";
  if (data === "n" || data === "N") return "new";
  if (data === "a") return "all";
  return seen;
}

function readConfirmation<T extends BoundedConfirmation>(dialog: T, review: ConfirmationReview): T {
  const readThrough = dialog.contentKey === review.contentKey ? dialog.readThrough ?? 0 : 0;
  return { ...dialog, scroll: review.start, contentKey: review.contentKey,
    readThrough: review.start <= readThrough ? Math.max(readThrough, review.end) : readThrough };
}

export function renderConfirmDialog(dialog: ConfirmDialog, width: number, height: number | undefined, ctx: ConfirmDialogContext): ConfirmationRender {
  return dialog.purpose === "delete" ? renderDeleteDialog(dialog, width, height, ctx) : renderFinishDialog(dialog, width, height, ctx);
}

export function renderRestartDialog(dialog: RestartDialog, width: number, height: number | undefined, ctx: ConfirmDialogContext): ConfirmationRender {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const body = [
    target ? `target  ${target.title}` : "target  unavailable",
    "r resumes this session; n starts a new conversation.",
    "a restarts every Active session.",
  ];
  const controls = [
    confirmLine("warning", "r restart selected", ctx.theme),
    confirmLine("warning", "n new conversation", ctx.theme),
    confirmLine("warning", "a restart active", ctx.theme),
    hintLine("Esc cancel · PgUp/PgDn read", ctx.theme),
  ];
  return renderBoundedConfirmation("Restart session", body, controls, dialog, width, height, ctx.theme, Boolean(target && target.kind !== "subagent"), dialog.targetId, targetReviewKey(target, []));
}

function scrollConfirmation<T extends BoundedConfirmation>(dialog: T, delta: number): T {
  return { ...dialog, scroll: Math.max(0, dialog.scroll + delta) };
}

function handleDeleteInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext, reviewedTarget: string): ConfirmDialog | undefined {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const subagents = subagentTargets(dialog.targetId, ctx);
  if (reviewedTarget !== targetReviewKey(target, subagents)) {
    ctx.setMessage("target changed; review the confirmation again");
    return { ...dialog, contentKey: undefined, readThrough: 0 };
  }
  const closeSubagents = data === "s";
  const finishWorktree = data === "w";
  const discardWorktree = data === "D";
  const deleteSession = data === "d";
  if (!closeSubagents && !finishWorktree && !discardWorktree && !deleteSession) return dialog;
  const worktree = Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
  const eligible = target && (
    deleteSession ? Boolean(ctx.actions.deleteSession)
      : closeSubagents ? target.kind !== "subagent" && subagents.length > 0 && Boolean(ctx.actions.closeSubagents)
        : finishWorktree ? worktree && Boolean(ctx.actions.finishWorktree)
          : worktree && Boolean(ctx.actions.discardWorktree)
  );
  if (!eligible) {
    ctx.setMessage("target or operation is no longer available");
    return { ...dialog, contentKey: undefined, readThrough: 0 };
  }
  const action = closeSubagents ? ctx.actions.closeSubagents : finishWorktree ? ctx.actions.finishWorktree : discardWorktree ? ctx.actions.discardWorktree : ctx.actions.deleteSession;
  const successMessage = closeSubagents ? "subagents closed" : finishWorktree ? "worktree finished" : discardWorktree ? "worktree discarded" : "session deleted";
  const busy = closeSubagents ? "subagents" : finishWorktree ? "finish" : discardWorktree ? "worktree" : "session";
  const busyDialog: ConfirmDialog = { ...dialog, busy };
  return runConfirmAction(busyDialog, action, successMessage, ctx);
}

function handleFinishInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext, reviewedTarget: string): ConfirmDialog | undefined {
  if (data !== "w") return dialog;
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  if (reviewedTarget !== targetReviewKey(target, subagentTargets(dialog.targetId, ctx)) || !target || target.kind === "subagent" || !isWorktreeSession(target) || target.worktreeOwnedByHub !== true || !ctx.actions.finishWorktree) {
    ctx.setMessage("target or operation is no longer available");
    return { ...dialog, contentKey: undefined, readThrough: 0 };
  }
  const busyDialog: ConfirmDialog = { ...dialog, busy: "finish" };
  return runConfirmAction(busyDialog, ctx.actions.finishWorktree, "worktree finished", ctx);
}

function runConfirmAction(dialog: ConfirmDialog, action: ((id: string) => void | Promise<void>) | undefined, successMessage: string, ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  try {
    const result = action?.(dialog.targetId);
    if (isPromise(result)) {
      void result.then(() => {
        if (ctx.dialog() !== dialog) return;
        ctx.close();
        ctx.setMessage(successMessage);
      }).catch((error: unknown) => {
        if (ctx.dialog() !== dialog) return;
        ctx.setDialog({ ...dialog, busy: false });
        ctx.setMessage(errorMessage(error));
      });
      return dialog;
    }
    ctx.setMessage(successMessage);
    return undefined;
  } catch (error) {
    ctx.setMessage(errorMessage(error));
    return { ...dialog, busy: false };
  }
}

function renderDeleteDialog(dialog: ConfirmDialog, width: number, height: number | undefined, ctx: ConfirmDialogContext): ConfirmationRender {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const subagents = subagentTargets(target?.id, ctx);
  const action = dialog.busy === "subagents" ? "closing subagents..." : dialog.busy === "finish" ? "finishing worktree..." : dialog.busy === "worktree" ? "discarding worktree..." : dialog.busy ? "deleting..." : "d delete session";
  const worktree = Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
  const choices = deleteChoices({ action, busy: Boolean(dialog.busy), subagentCount: subagents.length, targetIsSubagent: target?.kind === "subagent", worktree, canFinishWorktree: worktree && Boolean(ctx.actions.finishWorktree), theme: ctx.theme });
  const body = [
    target ? `target  ${target.title}` : "target  unavailable",
    worktree ? "Worktree session: choose whether to only forget it or discard the clean worktree." : "Removes this session from pi-agent-hub.",
    "Pi conversation files are kept.",
    ...(ctx.message() ? [`Error: ${ctx.message()}`] : []),
    ...(worktree ? [ctx.actions.finishWorktree ? "d keeps worktree and branch; D deletes the clean worktree and branch; w merges instead." : "d keeps worktree and branch; D deletes the clean worktree and branch."] : []),
  ];
  return renderBoundedConfirmation("Delete session", body, [...choices.filter(Boolean), hintLine("Esc cancel · PgUp/PgDn read", ctx.theme)], dialog, width, height, ctx.theme, Boolean(target) && !dialog.busy, dialog.targetId, targetReviewKey(target, subagents));
}

function renderFinishDialog(dialog: ConfirmDialog, width: number, height: number | undefined, ctx: ConfirmDialogContext): ConfirmationRender {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const worktree = target ? primaryWorktree(target) : undefined;
  const branch = worktree?.branch ?? target?.worktreeBranch ?? "unknown";
  const base = worktree?.baseBranch ?? target?.worktreeBaseBranch ?? "unknown";
  const eligible = Boolean(target && target.kind !== "subagent" && isWorktreeSession(target) && target.worktreeOwnedByHub === true && ctx.actions.finishWorktree);
  const body = [
    target ? `target   ${target.title}` : "target   unavailable",
    `branch   ${branch}`,
    `merge    ${branch} → ${base}`,
    "cleanup  remove hub-owned worktree, prune, delete merged branch",
    ...(ctx.message() ? [`Error: ${ctx.message()}`] : []),
  ];
  const controls = [
    dialog.busy ? "finishing worktree..." : confirmLine("warning", "w finish and merge", ctx.theme),
    hintLine("Esc cancel · PgUp/PgDn read", ctx.theme),
  ];
  return renderBoundedConfirmation("Finish worktree", body, controls, dialog, width, height, ctx.theme, eligible && !dialog.busy, dialog.targetId, targetReviewKey(target, subagentTargets(dialog.targetId, ctx)));
}

function renderBoundedConfirmation(title: string, bodyRows: string[], controls: string[], state: BoundedConfirmation, width: number, height: number | undefined, theme: SessionsTheme | undefined, eligible: boolean, targetId: string, targetKey: string): ConfirmationRender {
  const innerWidth = Math.max(1, Math.min(width - 2, 86));
  const body = bodyRows.flatMap((row) => row ? wrapTextWithAnsi(row, innerWidth) : [""]);
  const controlLines = controls.flatMap((row) => wrapTextWithAnsi(row, innerWidth));
  height ??= body.length + controlLines.length + 4;
  const contentKey = `${innerWidth}\n${title}\n${bodyRows.join("\n")}\n${controls.join("\n")}`;
  const available = Math.max(0, height - 4);
  const pageSize = Math.max(1, available - controlLines.length);
  const start = state.contentKey === contentKey ? Math.min(state.scroll, Math.max(0, body.length - pageSize)) : 0;
  const review: ConfirmationReview = { targetId, targetKey, contentKey, start, end: Math.min(body.length, start + pageSize), total: body.length, pageSize, actionable: eligible };
  if (height < 6 || available < controlLines.length + 1) {
    const rows = ["Resize to review this action safely.", hintLine("Esc cancel", theme)];
    return { lines: height < 6 ? rows.slice(0, Math.max(0, height)) : renderDialog(title, rows, width, theme).slice(0, height), review: { ...review, actionable: false, end: start } };
  }
  const visibleBody = Array.from({ length: pageSize }, (_, index) => body[start + index] ?? "");
  return { lines: renderDialog(title, [...visibleBody, ...controlLines], width, theme), review };
}

function targetReviewKey(target: ManagedSession | undefined, subagents: ManagedSession[]): string {
  return JSON.stringify([target?.id, target?.title, target?.cwd, target?.kind, target?.worktreeOwnedByHub,
    target ? primaryWorktree(target) : undefined, target?.worktrees, subagents.map((session) => session.id).sort()]);
}

function subagentTargets(parentId: string | undefined, ctx: ConfirmDialogContext): ManagedSession[] {
  if (!parentId) return [];
  const sessions = ctx.controller.snapshot().registry.sessions;
  const target = sessions.find((session) => session.id === parentId);
  if (!target || target.kind === "subagent") return [];
  const ids = sessionCascadeIds(sessions, parentId);
  ids.delete(parentId);
  return sessions.filter((session) => ids.has(session.id));
}

function confirmLine(token: "warning" | "error", text: string, theme?: SessionsTheme): string {
  const line = `▶ ${text}`;
  return theme ? styleToken(theme, token, line) : line;
}

function hintLine(text: string, theme?: SessionsTheme): string {
  const line = `  ${text}`;
  return theme ? styleToken(theme, "dim", line) : line;
}

function deleteChoices(input: { action: string; busy: boolean; subagentCount: number; targetIsSubagent: boolean; worktree: boolean; canFinishWorktree: boolean; theme?: SessionsTheme }): string[] {
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
    ...(input.canFinishWorktree ? [confirmLine("warning", "w finish instead — merge and remove", input.theme)] : []),
  );
  return choices;
}
