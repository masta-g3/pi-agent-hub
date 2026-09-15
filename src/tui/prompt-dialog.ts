import { Key, matchesKey } from "@earendil-works/pi-tui";
import { createTextInput, editTextInput, isEnterKey, renderTextInput, type TextInputState } from "./text-input.js";
import { styleToken, type SessionsTheme } from "./theme.js";
import type { PromptDialogContext } from "./dialog.js";

export interface PromptDialog {
  kind: "prompt";
  purpose: "filter" | "send";
  draft: TextInputState;
  error?: string;
  targetId?: string;
}

export function openFilterPrompt(ctx: PromptDialogContext): PromptDialog | undefined {
  if (ctx.controller.snapshot().registry.sessions.length === 0) return undefined;
  const draft = createTextInput(ctx.controller.snapshot().filter ?? "");
  ctx.controller.setFilter(draft.value);
  return { kind: "prompt", purpose: "filter", draft };
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

export function promptFooter(dialog: PromptDialog, ctx: PromptDialogContext): string {
  const now = ctx.now();
  switch (dialog.purpose) {
    case "filter": return filterFooter(dialog.draft, now, ctx.theme);
    case "send": return sendFooter(dialog.draft, sendTargetTitle(dialog, ctx), dialog.error, now, ctx.theme);
  }
}

function handleFilterInput(dialog: PromptDialog, data: string, ctx: PromptDialogContext): PromptDialog | undefined {
  if (matchesKey(data, Key.escape)) {
    setFilter(ctx, undefined);
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

function filterFooter(input: TextInputState, now: number, theme?: SessionsTheme): string {
  const text = `filter: ${renderTextInput(input, footerCursor(now))}  • ←→ edit • esc clear • enter done`;
  return theme ? styleToken(theme, "dim", text) : text;
}

function sendFooter(input: TextInputState, target: string, error: string | undefined, now: number, theme?: SessionsTheme): string {
  const text = error
    ? `send to ${target}: ${renderTextInput(input, footerCursor(now))}  • ${error}`
    : `send to ${target}: ${renderTextInput(input, footerCursor(now))}  • ←→ edit • esc cancel • enter send`;
  return theme ? styleToken(theme, error ? "error" : "dim", text) : text;
}

function footerCursor(now: number): string {
  const marker = Math.floor(now / 1_000) % 2 === 0 ? "█" : "▌";
  return `\u001b[5m${marker}\u001b[25m`;
}
