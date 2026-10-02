import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { createTextInput, editTextInput, isEnterKey, renderTextInput, type TextInputState } from "./text-input.js";
import { inputCursor, NARROW_LAYOUT_MAX_WIDTH, renderCursorValue, truncate } from "./layout.js";
import { styleToken, type SessionsTheme } from "./theme.js";
import type { PromptDialogContext } from "./dialog.js";

export interface PromptDialog {
  kind: "prompt";
  purpose: "filter" | "send";
  draft: TextInputState;
  error?: string;
  targetId?: string;
  originalFilter?: string;
}

export function openFilterPrompt(ctx: PromptDialogContext): PromptDialog | undefined {
  if (ctx.controller.snapshot().registry.sessions.length === 0) return undefined;
  const originalFilter = ctx.controller.snapshot().filter;
  const draft = createTextInput(originalFilter ?? "");
  return { kind: "prompt", purpose: "filter", draft, originalFilter };
}

export function openSendPrompt(ctx: PromptDialogContext): PromptDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows cannot receive input");
    return undefined;
  }
  if (selected.status === "stopped" || selected.status === "error") {
    ctx.setMessage("session is not live; press r to restart");
    return undefined;
  }
  if (!ctx.actions.sendMessage) {
    ctx.setMessage("send unavailable");
    return undefined;
  }
  return { kind: "prompt", purpose: "send", targetId: selected.id, draft: createTextInput() };
}

export function handlePromptInput(dialog: PromptDialog, data: string, ctx: PromptDialogContext): PromptDialog | undefined {
  switch (dialog.purpose) {
    case "filter": return handleFilterInput(dialog, data, ctx);
    case "send": return handleSendInput(dialog, data, ctx);
  }
}

export function promptFilterValue(dialog: PromptDialog | undefined): string | undefined {
  return dialog?.purpose === "filter" ? dialog.draft.value : undefined;
}

export function sendPromptFooter(dialog: PromptDialog, ctx: PromptDialogContext, availableWidth?: number): string {
  return sendFooter(dialog.draft, sendTargetTitle(dialog, ctx), dialog.error, ctx.now(), ctx.theme, availableWidth);
}

function handleFilterInput(dialog: PromptDialog, data: string, ctx: PromptDialogContext): PromptDialog | undefined {
  if (matchesKey(data, Key.escape)) {
    setFilter(ctx, dialog.originalFilter);
    return undefined;
  }
  if (isEnterKey(data)) {
    setFilter(ctx, dialog.draft.value);
    return undefined;
  }
  const edited = editTextInput(data, dialog.draft);
  if (!edited) return dialog;
  ctx.controller.setFilter(edited.value);
  return { ...dialog, draft: edited };
}

function setFilter(ctx: PromptDialogContext, value: string | undefined): void {
  if (ctx.setFilter) ctx.setFilter(value);
  else ctx.controller.setFilter(value);
}

function handleSendInput(dialog: PromptDialog, data: string, ctx: PromptDialogContext): PromptDialog | undefined {
  if (matchesKey(data, Key.escape)) {
    ctx.setMessage(undefined);
    return undefined;
  }
  if (isEnterKey(data)) {
    const target = ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
    if (!target) return undefined;
    const message = dialog.draft.value.trim();
    if (!message) return { ...dialog, error: "message is required" };
    ctx.runAction(
      () => ctx.actions.sendMessage?.(target.tmuxSession, message),
      "sending message...",
      () => { ctx.flashMessage(`sent → ${target.title}`); },
    );
    return undefined;
  }
  const edited = editTextInput(data, dialog.draft);
  if (!edited) return dialog;
  ctx.setMessage(undefined);
  return { ...dialog, draft: edited, error: undefined };
}

function sendTargetTitle(dialog: PromptDialog, ctx: PromptDialogContext): string {
  return ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId)?.title ?? "session";
}

function sendFooter(input: TextInputState, target: string, error: string | undefined, now: number, theme?: SessionsTheme, availableWidth?: number): string {
  const text = availableWidth !== undefined && availableWidth <= NARROW_LAYOUT_MAX_WIDTH
    ? compactPrompt(`send ${truncate(target, Math.max(4, Math.floor(availableWidth / 4)))}: `, input, error ? ` • ${truncate(error, Math.max(6, Math.floor(availableWidth / 3)))}` : " • esc • enter", availableWidth)
    : error
      ? `send to ${target}: ${renderTextInput(input, inputCursor(now))}  • ${error}`
      : `send to ${target}: ${renderTextInput(input, inputCursor(now))}  • ←→ edit • esc cancel • enter send`;
  return theme ? styleToken(theme, error ? "error" : "dim", text) : text;
}

function compactPrompt(prefix: string, input: TextInputState, suffix: string, width: number): string {
  const inputWidth = Math.max(4, width - visibleWidth(prefix) - visibleWidth(suffix));
  return truncate(`${prefix}${renderCursorValue(input.value, input.cursor, inputWidth, "start")}${suffix}`, width);
}