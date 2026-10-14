import { Key, matchesKey } from "@earendil-works/pi-tui";
import { createTextInput, editTextInput, isEnterKey, type TextInputState } from "./text-input.js";
import type { PromptDialogContext } from "./dialog.js";

export interface PromptDialog {
  kind: "prompt";
  purpose: "filter";
  draft: TextInputState;
  originalFilter?: string;
}

export function openFilterPrompt(ctx: PromptDialogContext): PromptDialog | undefined {
  if (ctx.controller.snapshot().registry.sessions.length === 0) return undefined;
  const originalFilter = ctx.controller.snapshot().filter;
  const draft = createTextInput(originalFilter ?? "");
  return { kind: "prompt", purpose: "filter", draft, originalFilter };
}

export function handlePromptInput(dialog: PromptDialog, data: string, ctx: PromptDialogContext): PromptDialog | undefined {
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

export function promptFilterValue(dialog: PromptDialog | undefined): string | undefined {
  return dialog?.draft.value;
}

function setFilter(ctx: PromptDialogContext, value: string | undefined): void {
  if (ctx.setFilter) ctx.setFilter(value);
  else ctx.controller.setFilter(value);
}
