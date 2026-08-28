import { Key, matchesKey } from "@earendil-works/pi-tui";
import { orderedSessionRows } from "../core/session-tree.js";
import { isEnterKey } from "./text-input.js";
import { createForm, editField, moveFocus, setValue, validateRequired, type FormState } from "./form.js";
import { renderForm } from "./layout.js";
import type { FormDialogContext } from "./dialog.js";

export type FormDialogPurpose = "fork" | "moveGroup" | "renameSession" | "renameGroup";

export interface FormDialog {
  kind: "form";
  purpose: FormDialogPurpose;
  targetId: string;
  form: FormState<string>;
  groupFrom?: string;
  returnTmuxSession?: string;
}

export function openForkDialog(ctx: FormDialogContext): FormDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows cannot be forked");
    return undefined;
  }
  if (selected.worktreeOwnedByHub === true || selected.worktreePath) {
    ctx.setMessage("worktree sessions cannot be forked in v1");
    return undefined;
  }
  return {
    kind: "form",
    purpose: "fork",
    targetId: selected.id,
    form: createForm([
      { key: "group", label: "group", value: selected.group, hint: "session group label" },
    ]),
  };
}

export function openMoveGroupDialog(ctx: FormDialogContext): FormDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows follow their parent group");
    return undefined;
  }
  const choices = moveGroupChoices(ctx, selected.group);
  return {
    kind: "form",
    purpose: "moveGroup",
    targetId: selected.id,
    form: createForm([{ key: "group", label: "group", value: choices[0] ?? "", hint: moveGroupHint(choices.length) }]),
  };
}

export function openRenameSessionForm(ctx: FormDialogContext, returnTmuxSession?: string): FormDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows cannot be renamed");
    return undefined;
  }
  if (selected.status === "stopped" || selected.status === "error") {
    ctx.setMessage("restart the Pi session before renaming");
    return undefined;
  }
  return {
    kind: "form",
    purpose: "renameSession",
    targetId: selected.id,
    returnTmuxSession,
    form: createForm([{ key: "title", label: "title", value: selected.title, hint: "exact Pi session name" }]),
  };
}

export function openRenameGroupDialog(ctx: FormDialogContext): FormDialog | undefined {
  const selected = ctx.controller.selected();
  if (!selected) return undefined;
  if (selected.kind === "subagent") {
    ctx.setMessage("subagent rows cannot rename groups");
    return undefined;
  }
  return {
    kind: "form",
    purpose: "renameGroup",
    targetId: selected.id,
    groupFrom: selected.group,
    form: createForm([{ key: "to", label: "to", value: selected.group, hint: `renames all sessions currently in ${selected.group}` }]),
  };
}

export function handleFormDialogInput(dialog: FormDialog, data: string, ctx: FormDialogContext): FormDialog | undefined {
  if (dialog.purpose === "moveGroup") {
    if (matchesKey(data, Key.ctrl("n"))) return cycleMoveGroup(dialog, 1, ctx);
    if (matchesKey(data, Key.ctrl("p"))) return cycleMoveGroup(dialog, -1, ctx);
  }
  if (matchesKey(data, Key.escape)) {
    ctx.setMessage(undefined);
    return undefined;
  }
  if (isEnterKey(data)) return submitFormDialog(dialog, ctx);
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) return { ...dialog, form: moveFocus(dialog.form, 1) };
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.up)) return { ...dialog, form: moveFocus(dialog.form, -1) };
  const edited = editField(dialog.form, data);
  if (!edited) return dialog;
  ctx.setMessage(undefined);
  return { ...dialog, form: edited };
}

export function renderFormDialog(dialog: FormDialog, width: number, ctx: FormDialogContext): string[] {
  const spec = formRenderSpec(dialog, ctx);
  return renderForm({
    title: spec.title,
    fields: dialog.form.order.map((key) => dialog.form.fields[key]),
    focus: dialog.form.focus,
    footer: spec.footer,
    narrowFooter: spec.narrowFooter,
  }, width, ctx.theme);
}

function submitFormDialog(dialog: FormDialog, ctx: FormDialogContext): FormDialog | undefined {
  switch (dialog.purpose) {
    case "fork": return submitForkDialog(dialog, ctx);
    case "moveGroup": return submitGroupDialog(dialog, ctx);
    case "renameSession": return submitRenameSessionDialog(dialog, ctx);
    case "renameGroup": return submitRenameGroupDialog(dialog, ctx);
  }
}

function submitForkDialog(dialog: FormDialog, ctx: FormDialogContext): FormDialog | undefined {
  const target = formTarget(dialog, ctx);
  if (!target) return undefined;
  if (target.kind === "subagent" || target.worktreeOwnedByHub === true || target.worktreePath) {
    ctx.setMessage("fork target is no longer available");
    return undefined;
  }
  const result = validateRequired(dialog.form);
  if (!result.ok) return { ...dialog, form: result.state };
  const group = result.state.fields.group.value;
  ctx.runAction(() => ctx.actions.forkSession?.(target.id, { group }), "forking session...");
  return undefined;
}

function submitGroupDialog(dialog: FormDialog, ctx: FormDialogContext): FormDialog | undefined {
  const target = formTarget(dialog, ctx);
  if (!target || target.kind === "subagent") {
    ctx.setMessage("move target is no longer available");
    return undefined;
  }
  const result = validateRequired(dialog.form);
  if (!result.ok) return { ...dialog, form: result.state };
  const group = result.state.fields.group.value;
  ctx.runAction(() => ctx.actions.changeGroup ? ctx.actions.changeGroup(target.id, group) : ctx.controller.moveSessionToGroup(target.id, group), "moving session...");
  return undefined;
}

function submitRenameSessionDialog(dialog: FormDialog, ctx: FormDialogContext): FormDialog | undefined {
  const target = formTarget(dialog, ctx);
  if (!target || target.kind === "subagent" || target.status === "stopped" || target.status === "error") {
    ctx.setMessage("rename target is no longer available");
    return undefined;
  }
  const result = validateRequired(dialog.form);
  if (!result.ok) return { ...dialog, form: result.state };
  const title = result.state.fields.title.value;
  ctx.runAction(
    () => {
      if (!ctx.actions.renameSession) throw new Error("rename transport unavailable");
      return ctx.actions.renameSession(target.id, title);
    },
    "renaming session...",
    () => { if (dialog.returnTmuxSession) ctx.attachSession(target); },
  );
  return undefined;
}

function submitRenameGroupDialog(dialog: FormDialog, ctx: FormDialogContext): FormDialog | undefined {
  const from = dialog.groupFrom;
  const target = formTarget(dialog, ctx);
  if (!from || !target || target.kind === "subagent" || target.group !== from) {
    ctx.setMessage("rename-group target has changed");
    return undefined;
  }
  const to = dialog.form.fields.to.value.trim();
  if (!to) return { ...dialog, form: setFieldError(dialog.form, "to", "group is required") };
  ctx.runAction(() => ctx.actions.renameGroup ? ctx.actions.renameGroup(from, to) : ctx.controller.renameGroup(from, to), "renaming group...");
  return undefined;
}

function formTarget(dialog: FormDialog, ctx: FormDialogContext) {
  return ctx.controller.snapshot().registry.sessions.find((session) => session.id === dialog.targetId);
}

function cycleMoveGroup(dialog: FormDialog, delta: 1 | -1, ctx: FormDialogContext): FormDialog {
  const choices = moveGroupChoices(ctx, formTarget(dialog, ctx)?.group);
  if (!choices.length) return dialog;
  const current = dialog.form.fields.group.value.trim();
  const currentIndex = choices.indexOf(current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + delta + choices.length) % choices.length : delta > 0 ? 0 : choices.length - 1;
  const next = choices[nextIndex];
  if (!next) return dialog;
  ctx.setMessage(undefined);
  return { ...dialog, form: setValue(dialog.form, "group", next) };
}

function moveGroupChoices(ctx: FormDialogContext, currentGroup: string | undefined): string[] {
  const snapshot = ctx.controller.snapshot();
  const choices: string[] = [];
  for (const session of orderedSessionRows(snapshot.sessions, snapshot.filter)) {
    if (session.kind === "subagent" || session.group === currentGroup || choices.includes(session.group)) continue;
    choices.push(session.group);
  }
  return choices;
}

function formRenderSpec(dialog: FormDialog, ctx: FormDialogContext): { title: string; footer: string; narrowFooter: string } {
  switch (dialog.purpose) {
    case "fork": return { title: "Fork session", footer: "tab next · ←→ edit · enter fork · esc cancel", narrowFooter: "tab · enter · esc" };
    case "moveGroup": {
      const choices = moveGroupChoices(ctx, formTarget(dialog, ctx)?.group);
      return {
        title: "Move to group",
        footer: choices.length ? "ctrl-n/p cycle · ←→ edit · enter move · esc cancel" : "←→ edit · enter move · esc cancel",
        narrowFooter: choices.length ? "ctrl-n/p · enter · esc" : "enter · esc",
      };
    }
    case "renameSession": return { title: "Rename session", footer: "←→ edit · enter rename · esc cancel", narrowFooter: "enter · esc" };
    case "renameGroup": return { title: "Rename group", footer: "←→ edit · enter rename · esc cancel", narrowFooter: "enter · esc" };
  }
}

function moveGroupHint(count: number): string {
  if (count === 0) return "existing or new group label";
  return `ctrl-n/p cycle ${count} existing ${count === 1 ? "group" : "groups"} · or type new`;
}

function setFieldError<K extends string>(state: FormState<K>, key: K, error: string): FormState<K> {
  return {
    ...state,
    fields: { ...state.fields, [key]: { ...state.fields[key], error } },
    focus: key,
  };
}
