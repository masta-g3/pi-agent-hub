import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import type { ManagedSession } from "../src/core/types.js";
import type { DialogContext, SessionDialog } from "../src/tui/dialog.js";
import { handleFormDialogInput, openForkDialog, openMoveGroupDialog, openRenameGroupDialog, openRenameSessionForm } from "../src/tui/form-dialogs.js";
import { createPickerDialog, handlePickerDialogInput } from "../src/tui/picker-dialog.js";

function session(id: string, group = "default"): ManagedSession {
  return { id, title: id, group, cwd: `/tmp/${id}`, tmuxSession: `tmux-${id}`, status: "idle", createdAt: 1, updatedAt: 1 };
}

function context(controller: SessionsController, actions: DialogContext["actions"]): DialogContext {
  let message: string | undefined;
  let dialog: SessionDialog | undefined;
  return {
    controller, actions, theme: undefined, now: () => 0,
    close: () => { dialog = undefined; }, setDialog: (next) => { dialog = next; }, dialog: () => dialog,
    setMessage: (next) => { message = next; }, message: () => message, flashMessage: () => {},
    runAction: (action) => { action(); }, attachSession: () => {}, stop: () => {},
  };
}

test("move-group form keeps the session selected when it opened", () => {
  const first = session("first");
  const second = session("second", "other");
  const controller = new SessionsController({ version: 1, sessions: [first, second] });
  let moved: string | undefined;
  const ctx = context(controller, { changeGroup: (id) => { moved = id; } });
  const dialog = openMoveGroupDialog(ctx)!;
  controller.selectSession(second.id);

  handleFormDialogInput(dialog, "\r", ctx);

  assert.equal(moved, first.id);
});

test("fork and rename forms keep the session selected when they opened", () => {
  const first = session("first");
  const second = session("second");
  const controller = new SessionsController({ version: 1, sessions: [first, second] });
  const forked: string[] = [];
  const renamed: string[] = [];
  const ctx = context(controller, {
    forkSession: (id) => { forked.push(id); },
    renameSession: (id) => { renamed.push(id); },
  });
  const fork = openForkDialog(ctx)!;
  const rename = openRenameSessionForm(ctx)!;
  controller.selectSession(second.id);

  handleFormDialogInput(fork, "\r", ctx);
  handleFormDialogInput(rename, "\r", ctx);

  assert.deepEqual(forked, [first.id]);
  assert.deepEqual(renamed, [first.id]);
});

test("rename-group form keeps its original group target", () => {
  const first = session("first", "alpha");
  const second = session("second", "beta");
  const controller = new SessionsController({ version: 1, sessions: [first, second] });
  let renamed: { from: string; to: string } | undefined;
  const ctx = context(controller, { renameGroup: (from, to) => { renamed = { from, to }; } });
  const dialog = openRenameGroupDialog(ctx)!;
  controller.selectSession(second.id);

  handleFormDialogInput(dialog, "\r", ctx);

  assert.deepEqual(renamed, { from: "alpha", to: "alpha" });
});

test("session form aborts when its bound target disappears", () => {
  const first = session("first");
  const controller = new SessionsController({ version: 1, sessions: [first] });
  let renamed = false;
  const ctx = context(controller, { renameSession: () => { renamed = true; } });
  const dialog = openRenameSessionForm(ctx)!;
  controller.removeSession(first.id);

  handleFormDialogInput(dialog, "\r", ctx);

  assert.equal(renamed, false);
  assert.equal(ctx.message(), "rename target is no longer available");
});

test("picker applies to its bound project after selection changes", () => {
  const first = session("first");
  const second = session("second");
  const controller = new SessionsController({ version: 1, sessions: [first, second] });
  let target: unknown;
  const ctx = context(controller, {
    pickerTarget: () => ({ sessionId: first.id, projectCwd: first.cwd }),
    applySkills: (_items, bound) => { target = bound; },
  });
  const dialog = createPickerDialog("skills", [{ name: "one", enabled: true }], ctx)!;
  controller.selectSession(second.id);

  handlePickerDialogInput(dialog, "\r", ctx);

  assert.deepEqual(target, { sessionId: first.id, projectCwd: first.cwd });
});

test("picker aborts when its bound session disappears", () => {
  const first = session("first");
  const controller = new SessionsController({ version: 1, sessions: [first] });
  let applied = false;
  const ctx = context(controller, {
    pickerTarget: () => ({ sessionId: first.id, projectCwd: first.cwd }),
    applyMcpServers: () => { applied = true; },
  });
  const dialog = createPickerDialog("mcp", [{ name: "one", enabled: true }], ctx)!;
  controller.removeSession(first.id);

  handlePickerDialogInput(dialog, "\r", ctx);

  assert.equal(applied, false);
  assert.equal(ctx.message(), "picker target is no longer available");
});
