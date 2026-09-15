import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import type { DialogContext, SessionDialog } from "../src/tui/dialog.js";
import { createPickerDialog, handlePickerDialogInput, type PickerDialog } from "../src/tui/picker-dialog.js";

function context(actions: DialogContext["actions"]): DialogContext {
  let dialog: SessionDialog | undefined;
  return {
    controller: new SessionsController(),
    actions,
    theme: undefined,
    now: () => 0,
    close: () => { dialog = undefined; },
    setDialog: (next) => { dialog = next; },
    dialog: () => dialog,
    setMessage: () => {},
    message: () => undefined,
    flashMessage: () => {},
    runAction: () => {},
    attachSession: () => {},
    stop: () => {},
  };
}

test("skills picker applies synchronous skill pool saves", () => {
  let savedDir = "";
  const ctx = context({
    skillPoolDir: () => savedDir,
    saveSkillPoolDir: (dir) => {
      savedDir = dir;
      return [{ name: "new-skill", enabled: false }];
    },
  });
  let dialog = createPickerDialog("skills", [{ name: "old-skill", enabled: false }], ctx)!;

  dialog = handlePickerDialogInput(dialog, "\x1be", ctx) as PickerDialog;
  for (const char of "/tmp/new-skills") dialog = handlePickerDialogInput(dialog, char, ctx) as PickerDialog;
  dialog = handlePickerDialogInput(dialog, "\r", ctx) as PickerDialog;

  assert.equal(savedDir, "/tmp/new-skills");
  assert.equal(dialog.picker.poolPending, false);
  assert.equal(dialog.picker.poolInput, undefined);
  assert.equal(dialog.picker.poolDir, "/tmp/new-skills");
  assert.equal(dialog.picker.poolMessage, "skill pool saved; press enter to apply selected skills");
  assert.deepEqual(dialog.picker.items, [{ name: "new-skill", enabled: false }]);
});
