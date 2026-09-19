import assert from "node:assert/strict";
import test from "node:test";
import { createThemeDialog, handleThemeDialogInput, renderThemeDialog } from "../src/tui/theme-dialog.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";

function context() {
  const previews: string[] = [];
  const applies: Array<{ setting: string; syncPi: boolean }> = [];
  const cancelled: string[] = [];
  let closed = false;
  let message: string | undefined;
  let latestDialog: ReturnType<typeof createThemeDialog> | undefined;
  return {
    viewport: { width: 100, height: 24 },
    previews,
    applies,
    cancelled,
    get closed() { return closed; },
    get message() { return message; },
    get latestDialog() { return latestDialog; },
    actions: {
      previewDashboardTheme(setting: string) { previews.push(setting); },
      cancelDashboardTheme(setting: string) { cancelled.push(setting); },
      async applyDashboardTheme(setting: string, syncPi: boolean) { applies.push({ setting, syncPi }); },
    },
    close() { closed = true; },
    setDialog(dialog: ReturnType<typeof createThemeDialog>) { latestDialog = dialog; },
    setMessage(value: string | undefined) { message = value; },
    flashMessage() {},
  };
}

const names = ["dark", "light", "catppuccin-latte", "catppuccin-mocha"];

test("theme dialog previews fixed themes on movement and restores on escape", () => {
  const ctx = context();
  let dialog: ReturnType<typeof handleThemeDialogInput> = createThemeDialog({ names, setting: "dark", syncPi: true });
  dialog = handleThemeDialogInput(dialog, "\u001b[B", ctx);
  assert.equal(dialog?.setting, "light");
  assert.deepEqual(ctx.previews, ["light"]);

  dialog = handleThemeDialogInput(dialog!, "\u001b", ctx);
  assert.equal(dialog, undefined);
  assert.deepEqual(ctx.cancelled, ["dark"]);
});

test("theme dialog configures an Automatic pair and toggles Pi sync", () => {
  const ctx = context();
  let dialog: ReturnType<typeof handleThemeDialogInput> = createThemeDialog({ names, setting: "dark", syncPi: true });
  dialog = handleThemeDialogInput(dialog, "\u001b[A", ctx)!;
  assert.equal(dialog.setting, "light/dark");
  assert.equal(ctx.previews.at(-1), "light/dark");
  dialog = handleThemeDialogInput(dialog, " ", ctx)!;
  assert.equal(dialog.syncPi, false);
  assert.equal(dialog.setting, "light/dark");
  dialog = handleThemeDialogInput(dialog, " ", ctx)!;

  dialog = handleThemeDialogInput(dialog, "\u001b[B", ctx)!;
  dialog = handleThemeDialogInput(dialog, "\u001b[C", ctx)!;
  assert.equal(dialog.setting, "catppuccin-latte/dark");

  while (dialog.selected !== "sync") dialog = handleThemeDialogInput(dialog, "\u001b[B", ctx)!;
  dialog = handleThemeDialogInput(dialog, " ", ctx)!;
  assert.equal(dialog.syncPi, false);
});

test("theme dialog retains saved and edited Automatic pairs across fixed previews", async () => {
  const ctx = context();
  let dialog = createThemeDialog({ names, setting: "catppuccin-latte/catppuccin-mocha", syncPi: true });
  for (const key of ["j", "j", "j", "k"]) dialog = handleThemeDialogInput(dialog, key, ctx)!;
  assert.equal(dialog.selected, "automatic");
  assert.equal(dialog.setting, "catppuccin-latte/catppuccin-mocha");
  dialog = handleThemeDialogInput(dialog, "j", ctx)!;
  dialog = handleThemeDialogInput(dialog, "\u001b[D", ctx)!;
  assert.equal(dialog.setting, "light/catppuccin-mocha");
  for (const key of ["j", "j", "k"]) dialog = handleThemeDialogInput(dialog, key, ctx)!;
  assert.equal(dialog.setting, "light/catppuccin-mocha");
  handleThemeDialogInput(dialog, "\r", ctx);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ctx.applies, [{ setting: "light/catppuccin-mocha", syncPi: true }]);
});

test("theme dialog Enter submits the visible setting", async () => {
  const ctx = context();
  const dialog = createThemeDialog({ names, setting: "light/dark", syncPi: false });
  const pending = handleThemeDialogInput(dialog, "\r", ctx);
  assert.equal(pending?.pending, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ctx.applies, [{ setting: "light/dark", syncPi: false }]);
  assert.equal(ctx.closed, true);
});

test("theme dialog keeps persistence errors visible and retryable", async () => {
  const ctx = context();
  ctx.actions.applyDashboardTheme = async () => { throw new Error("settings locked"); };
  const dialog = createThemeDialog({ names, setting: "dark", syncPi: true });
  handleThemeDialogInput(dialog, "\r", ctx);
  await new Promise((resolve) => setImmediate(resolve));
  const failed = ctx.latestDialog;
  assert.equal(failed?.pending, false);
  assert.equal(failed?.error, "settings locked");
  assert.match(stripAnsi(renderThemeDialog(failed!, 80, 14, darkTheme).join("\n")), /settings locked/);
});

test("theme dialog render is themed and width safe", () => {
  const dialog = createThemeDialog({ names, setting: "light/dark", syncPi: true });
  for (const width of [40, 80]) {
    const lines = renderThemeDialog(dialog, width, 12, darkTheme);
    assert.match(stripAnsi(lines.join("\n")), /Automatic/);
    assert.match(stripAnsi(lines.join("\n")), /Sync to Pi/);
    assert.match(stripAnsi(lines.join("\n")), /\[✓\] on/);
    for (const line of lines) assert.equal(stripAnsi(line).length, Math.min(width, 88));
    assert.ok(lines.length <= 12);
  }
});
