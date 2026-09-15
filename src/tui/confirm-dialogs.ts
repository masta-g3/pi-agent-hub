import { Key, matchesKey } from "@earendil-works/pi-tui";
import { sessionCascadeIds } from "../core/session-tree.js";
import { isWorktreeSession, primaryWorktree } from "../core/worktree.js";
import type { ManagedSession } from "../core/types.js";
import { errorMessage, isPromise, type ConfirmDialogContext } from "./dialog.js";
import { renderDialog } from "./layout.js";
import { styleToken, type SessionsTheme } from "./theme.js";

export interface ConfirmDialog {
  kind: "confirm";
  purpose: "delete" | "finish";
  targetId: string;
  busy: false | "session" | "subagents" | "worktree" | "finish";
}

export function openDeleteDialog(ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  return { kind: "confirm", purpose: "delete", targetId: selected.id, busy: false };
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
  return { kind: "confirm", purpose: "finish", targetId: selected.id, busy: false };
}

export function handleConfirmInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  if (dialog.purpose === "delete") return handleDeleteInput(dialog, data, ctx);
  return handleFinishInput(dialog, data, ctx);
}

export function renderConfirmDialog(dialog: ConfirmDialog, width: number, ctx: ConfirmDialogContext): string[] {
  return dialog.purpose === "delete" ? renderDeleteDialog(dialog, width, ctx) : renderFinishDialog(dialog, width, ctx);
}

export function renderRestartDialog(width: number, ctx: ConfirmDialogContext): string[] {
  const selected = ctx.controller.selected();
  return renderDialog("Restart session", [
    selected ? `target  ${selected.title}` : "target  none",
    "",
    confirmLine("warning", "r restart selected", ctx.theme),
    confirmLine("warning", "n new conversation", ctx.theme),
    confirmLine("warning", "a restart active", ctx.theme),
    hintLine("Esc cancel", ctx.theme),
  ], width, ctx.theme);
}

function handleDeleteInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  if (matchesKey(data, Key.escape)) {
    if (dialog.busy) return dialog;
    ctx.setMessage(undefined);
    return undefined;
  }
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const closeSubagents = data === "s" && subagentTargets(dialog.targetId, ctx).length > 0;
  const finishWorktree = data === "w" && Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true && ctx.actions.finishWorktree);
  const discardWorktree = data === "D" && Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
  if ((data !== "d" && !closeSubagents && !discardWorktree && !finishWorktree) || dialog.busy) return dialog;
  const action = closeSubagents ? ctx.actions.closeSubagents : finishWorktree ? ctx.actions.finishWorktree : discardWorktree ? ctx.actions.discardWorktree : ctx.actions.deleteSession;
  const successMessage = closeSubagents ? "subagents closed" : finishWorktree ? "worktree finished" : discardWorktree ? "worktree discarded" : "session deleted";
  const busy = closeSubagents ? "subagents" : finishWorktree ? "finish" : discardWorktree ? "worktree" : "session";
  const busyDialog: ConfirmDialog = { ...dialog, busy };
  return runConfirmAction(busyDialog, action, successMessage, ctx);
}

function handleFinishInput(dialog: ConfirmDialog, data: string, ctx: ConfirmDialogContext): ConfirmDialog | undefined {
  if (matchesKey(data, Key.escape)) {
    if (dialog.busy) return dialog;
    ctx.setMessage(undefined);
    return undefined;
  }
  if (data !== "w" || dialog.busy) return dialog;
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

function renderDeleteDialog(dialog: ConfirmDialog, width: number, ctx: ConfirmDialogContext): string[] {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const subagents = subagentTargets(target?.id, ctx);
  const action = dialog.busy === "subagents" ? "closing subagents..." : dialog.busy === "finish" ? "finishing worktree..." : dialog.busy === "worktree" ? "discarding worktree..." : dialog.busy ? "deleting..." : ctxMessageOr(ctx, "d delete session");
  const worktree = Boolean(target && isWorktreeSession(target) && target.worktreeOwnedByHub === true);
  const choices = deleteChoices({ action, busy: Boolean(dialog.busy || ctxMessage(ctx)), subagentCount: subagents.length, targetIsSubagent: target?.kind === "subagent", worktree, canFinishWorktree: worktree && Boolean(ctx.actions.finishWorktree), theme: ctx.theme });
  return renderDialog("Delete session", [
    target ? `target  ${target.title}` : "target  none",
    "",
    worktree ? "Worktree session: choose whether to only forget it or discard the clean worktree." : "Removes this session from pi-agent-hub.",
    "Pi conversation files are kept.",
    ...(worktree ? [ctx.actions.finishWorktree ? "d keeps worktree and branch; D deletes the clean worktree and branch; w merges instead." : "d keeps worktree and branch; D deletes the clean worktree and branch."] : []),
    "",
    ...choices.filter(Boolean),
    hintLine("Esc cancel", ctx.theme),
  ], width, ctx.theme);
}

function renderFinishDialog(dialog: ConfirmDialog, width: number, ctx: ConfirmDialogContext): string[] {
  const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
  const worktree = target ? primaryWorktree(target) : undefined;
  const branch = worktree?.branch ?? target?.worktreeBranch ?? "unknown";
  const base = worktree?.baseBranch ?? target?.worktreeBaseBranch ?? "unknown";
  return renderDialog("Finish worktree", [
    target ? `target   ${target.title}` : "target   none",
    `branch   ${branch}`,
    `merge    ${branch} → ${base}`,
    "cleanup  remove hub-owned worktree, prune, delete merged branch",
    "",
    dialog.busy || ctxMessage(ctx) ? (ctxMessage(ctx) ?? "finishing worktree...") : confirmLine("warning", "w finish and merge", ctx.theme),
    hintLine("Esc cancel", ctx.theme),
  ], width, ctx.theme);
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

function ctxMessage(ctx: ConfirmDialogContext): string | undefined {
  return ctx.message();
}

function ctxMessageOr(ctx: ConfirmDialogContext, fallback: string): string {
  return ctxMessage(ctx) ?? fallback;
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
