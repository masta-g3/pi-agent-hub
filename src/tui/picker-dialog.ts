import { Key, matchesKey } from "@earendil-works/pi-tui";
import { projectStateCwd } from "../core/multi-repo.js";
import { createTextInput, editTextInput, isEnterKey } from "./text-input.js";
import { errorMessage, isPromise, type PickerDialogContext, type ProjectPickerTarget } from "./dialog.js";
import { movePickerSelection, renderTwoColumnPicker, switchPickerColumn, togglePickerItem, type PickerItem, type PickerState } from "./two-column-picker.js";

export interface PickerDialog {
  kind: "picker";
  purpose: "skills" | "mcp";
  target: ProjectPickerTarget;
  picker: PickerState;
  saveId: number;
}

export function createPickerDialog(purpose: "skills" | "mcp", items: PickerItem[], ctx: PickerDialogContext, target?: ProjectPickerTarget): PickerDialog | undefined {
  const poolDir = purpose === "skills" ? ctx.actions.skillPoolDir?.() : undefined;
  if (!items.length && !(purpose === "skills" && poolDir !== undefined)) {
    ctx.setMessage(`${purpose}: nothing available`);
    return undefined;
  }
  ctx.setMessage(undefined);
  return {
    kind: "picker",
    purpose,
    target: target ?? ctx.actions.pickerTarget?.() ?? pickerTargetFromSelection(ctx),
    saveId: 0,
    picker: {
      title: purpose === "skills" ? "Skills" : "MCP — [project]",
      items,
      selected: 0,
      ...(purpose === "skills" && poolDir !== undefined ? { poolDir, poolDirExtraCount: ctx.actions.skillPoolDirExtraCount?.() ?? 0 } : {}),
    },
  };
}

export function handlePickerDialogInput(dialog: PickerDialog, data: string, ctx: PickerDialogContext): PickerDialog | undefined {
  if (dialog.picker.poolPending) return dialog;
  if (dialog.purpose === "skills" && dialog.picker.poolInput) return handleSkillPoolInput(dialog, data, ctx);
  if (matchesKey(data, Key.escape)) return undefined;
  if (dialog.purpose === "skills" && matchesKey(data, Key.alt("e"))) return { ...dialog, picker: { ...dialog.picker, poolInput: createTextInput(dialog.picker.poolDir ?? ""), poolError: undefined, poolMessage: undefined } };
  if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) return { ...dialog, picker: switchPickerColumn(dialog.picker) };
  if (matchesKey(data, Key.down)) return { ...dialog, picker: movePickerSelection(dialog.picker, 1) };
  if (matchesKey(data, Key.up)) return { ...dialog, picker: movePickerSelection(dialog.picker, -1) };
  if (matchesKey(data, Key.space) || data === " ") return { ...dialog, picker: togglePickerItem(dialog.picker) };
  if (isEnterKey(data)) return applyPickerSelection(dialog, ctx);
  const edited = editPickerSearch(data, dialog.picker);
  return edited ? { ...dialog, picker: { ...edited, poolError: undefined, poolMessage: undefined } } : dialog;
}

export function renderPickerDialog(dialog: PickerDialog, width: number, ctx: PickerDialogContext): string[] {
  return renderTwoColumnPicker(dialog.picker, width, ctx.theme);
}

function handleSkillPoolInput(dialog: PickerDialog, data: string, ctx: PickerDialogContext): PickerDialog | undefined {
  if (!dialog.picker.poolInput) return dialog;
  if (matchesKey(data, Key.escape)) return { ...dialog, picker: { ...dialog.picker, poolInput: undefined, poolError: undefined, poolMessage: undefined } };
  if (isEnterKey(data)) {
    const dir = dialog.picker.poolInput.value.trim();
    if (!dir) return { ...dialog, picker: { ...dialog.picker, poolError: "skill pool dir cannot be blank", poolMessage: undefined } };
    const save = ctx.actions.saveSkillPoolDir;
    if (!save) return { ...dialog, picker: { ...dialog.picker, poolError: "skill pool editing unavailable", poolMessage: undefined } };
    const pending: PickerDialog = { ...dialog, saveId: dialog.saveId + 1, picker: { ...dialog.picker, poolPending: true, poolMessage: "saving skill pool...", poolError: undefined } };
    try {
      if (!validPickerTarget(dialog.target, ctx)) return pickerTargetErrorDialog(dialog);
      const result = save(dir, dialog.target);
      if (!isPromise<PickerItem[]>(result)) return savedSkillPoolDialog(pending, result, dir, ctx);
      void result.then((items) => {
        if (ctx.dialog() === pending) ctx.setDialog(savedSkillPoolDialog(pending, items, dir, ctx));
      }).catch((error: unknown) => {
        if (ctx.dialog() === pending) ctx.setDialog(skillPoolErrorDialog(pending, error));
      });
      return pending;
    } catch (error) {
      return skillPoolErrorDialog(pending, error);
    }
  }
  const edited = editTextInput(data, dialog.picker.poolInput);
  return edited ? { ...dialog, picker: { ...dialog.picker, poolInput: edited, poolError: undefined, poolMessage: undefined } } : dialog;
}

function savedSkillPoolDialog(pending: PickerDialog, items: PickerItem[], dir: string, ctx: PickerDialogContext): PickerDialog {
  return {
    ...pending,
    picker: {
      ...pending.picker,
      items,
      selected: 0,
      poolDir: ctx.actions.skillPoolDir?.() || dir,
      poolDirExtraCount: ctx.actions.skillPoolDirExtraCount?.() ?? 0,
      poolInput: undefined,
      poolPending: false,
      poolMessage: "skill pool saved; press enter to apply selected skills",
      poolError: undefined,
    },
  };
}

function skillPoolErrorDialog(pending: PickerDialog, error: unknown): PickerDialog {
  return { ...pending, picker: { ...pending.picker, poolPending: false, poolError: errorMessage(error), poolMessage: undefined } };
}

function applyPickerSelection(dialog: PickerDialog, ctx: PickerDialogContext): undefined {
  if (!validPickerTarget(dialog.target, ctx)) {
    ctx.setMessage("picker target is no longer available");
    return undefined;
  }
  const items = dialog.picker.items;
  const apply = dialog.purpose === "skills" ? ctx.actions.applySkills : ctx.actions.applyMcpServers;
  const success = dialog.purpose === "skills" ? "restart session to reload skills" : "restart session to reload MCP tools";
  try {
    const result = apply?.(items, dialog.target);
    if (isPromise(result)) void result.then(() => { ctx.setMessage(success); }).catch((error: unknown) => { ctx.setMessage(errorMessage(error)); });
    else ctx.setMessage(success);
  } catch (error) {
    ctx.setMessage(errorMessage(error));
  }
  return undefined;
}

function pickerTargetFromSelection(ctx: PickerDialogContext): ProjectPickerTarget {
  const selected = ctx.controller.selected();
  return selected ? { sessionId: selected.id, projectCwd: projectStateCwd(selected) } : { projectCwd: process.cwd() };
}

function validPickerTarget(target: ProjectPickerTarget, ctx: PickerDialogContext): boolean {
  if (!target.sessionId) return true;
  const session = ctx.controller.snapshot().registry.sessions.find((item) => item.id === target.sessionId);
  return Boolean(session && projectStateCwd(session) === target.projectCwd);
}

function pickerTargetErrorDialog(dialog: PickerDialog): PickerDialog {
  return { ...dialog, picker: { ...dialog.picker, poolError: "picker target is no longer available", poolMessage: undefined } };
}

function editPickerSearch(data: string, picker: PickerState): PickerState | undefined {
  const edited = editTextInput(data, createTextInput(picker.filter ?? "", picker.filterCursor));
  if (!edited) return undefined;
  return { ...picker, filter: edited.value, filterCursor: edited.cursor, selected: 0 };
}
