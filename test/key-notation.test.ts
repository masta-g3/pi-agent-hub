import assert from "node:assert/strict";
import test from "node:test";
import { SessionsController } from "../src/app/controller.js";
import type { RuntimeSession } from "../src/core/types.js";
import { formatKey } from "../src/tui/dashboard-shortcuts.js";
import { buildDashboardCommands, dashboardFooter, pinnedDashboardFooter, conversationDashboardFooter } from "../src/tui/dashboard-commands.js";
import type { DialogContext } from "../src/tui/dialog.js";
import { openForkDialog, openForkCompactDialog, openMoveGroupDialog, openRenameSessionForm, openRenameGroupDialog, renderFormDialog } from "../src/tui/form-dialogs.js";
import { openNewSessionDialog, renderNewSessionDialog } from "../src/tui/new-session-dialog.js";
import { createPickerDialog, renderPickerDialog } from "../src/tui/picker-dialog.js";
import { createThemeDialog, renderThemeDialog } from "../src/tui/theme-dialog.js";
import { createCommandPalette, renderCommandPalette } from "../src/tui/command-palette-dialog.js";
import { openDeleteDialog, openFinishDialog, openArchiveDialog, createRestartDialog, renderConfirmDialog, renderArchiveDialog, renderRestartDialog } from "../src/tui/confirm-dialogs.js";
import { createQuestionDialog, handleQuestionInput, renderQuestionPanel } from "../src/tui/question-dialog.js";
import { openFavoritesDialog, renderFavoritesDialog } from "../src/tui/session-favorites-dialog.js";
import { createRepoPicker, renderRepoPicker } from "../src/tui/repo-picker.js";
import { createTextInput } from "../src/tui/text-input.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";

const selected: RuntimeSession = {
  id: "one", title: "Session", cwd: "/tmp", group: "team", tmuxSession: "tmux-one", status: "idle",
  createdAt: 1, updatedAt: 1, piSessionId: "pi-one", interaction: { version: 1, instanceId: "instance" },
};

function context(width: number): DialogContext {
  return {
    viewport: { width, height: 100 }, controller: new SessionsController({ version: 1, sessions: [selected] }),
    actions: { finishWorktree: () => {}, sendMessage: () => {}, interactionTarget: () => ({ managedId: "one", piSessionId: "pi-one", instanceId: "instance" }), newFormContext: () => ({ cwd: "/tmp" }), skillPoolDir: () => "/tmp/skills",
      favorites: { load: () => ({ version: 1, favorites: [{ id: "fav", name: "Team", cwds: ["/tmp"] }] }),
        save: () => ({ version: 1, favorites: [] }), update: () => ({ version: 1, favorites: [] }),
        rename: () => ({ version: 1, favorites: [] }), remove: () => ({ version: 1, favorites: [] }) } },
    theme: darkTheme, now: () => 0, close: () => {}, setDialog: () => {}, dialog: () => undefined,
    setMessage: () => {}, message: () => undefined, flashMessage: () => {}, runAction: () => {}, attachSession: () => {}, stop: () => {},
  };
}

const oldNotation = /\bctrl-|\^[A-Z]\b|\bC-[a-z]\b|\bM-[a-z0-9]\b|\benter |\besc /;
function consistent(lines: string[] | string, surface: string): void {
  const text = stripAnsi(typeof lines === "string" ? lines : lines.join("\n"));
  assert.doesNotMatch(text, oldNotation, surface);
}

test("formatKey converts display notation without changing printable key case", () => {
  for (const [binding, display] of [
    ["C-o", "Ctrl+O"], ["M-1", "Alt+1"], ["M-n", "Alt+N"], ["S-up", "Shift+↑"],
    ["Shift+Up", "Shift+↑"], ["Shift+Down", "Shift+↓"], ["enter", "Enter"], ["escape", "Esc"],
    ["tab", "Tab"], ["space", "Space"], ["pageup", "PgUp"], ["pagedown", "PgDn"],
    ["home", "Home"], ["end", "End"], ["a", "a"], ["A", "A"], [":", ":"], ["]", "]"],
  ]) assert.equal(formatKey(binding!), display);
});

for (const width of [80, 160]) {
  test(`${width}-column Help uses primary keys and hides compatibility aliases`, () => {
    const ctx = context(width);
    const view = new SessionsView(ctx.controller, () => {}, { terminalRows: () => 200,
      dashboardShortcuts: [{ key: "C-o", label: "Custom", send: "/custom" }] });
    view.handleInput("?");
    const text = stripAnsi(view.render(width).join("\n"));
    consistent(text, "Help");
    assert.equal((text.match(/Open in Pi(?: · [^\n│]*?)?\s+Enter/g) ?? []).length, 1);
    assert.match(text, /Custom(?: · send \/custom)?\s+Ctrl\+O/);
    assert.doesNotMatch(text, /C-m|C-j|M-n|Alt\+N|R\/e/);
    assert.match(text, /subagent rows/);
  });

  test(`${width}-column rendered footer, palette, workspace, and dialog hints use one notation`, () => {
    const ctx = context(width);
    for (const footer of [dashboardFooter(width), dashboardFooter(width, { coaching: true }), pinnedDashboardFooter(width), conversationDashboardFooter()]) consistent(footer, "Footer");
    const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, configuredShortcuts: [{ key: "C-o", label: "Custom", send: "/custom" }] });
    assert.equal(commands.find(command => command.id.startsWith("shortcut:"))?.displayKey, "Ctrl+O");
    consistent(renderCommandPalette(createCommandPalette(), commands, width, 100, darkTheme).lines, "Palette");
    const view = new SessionsView(ctx.controller, () => {}, { terminalRows: () => 100, dashboardShortcuts: [{ key: "C-o", label: "Custom", send: "/custom" }] });
    view.render(width);
    view.handleInput("i");
    consistent(view.render(width), "Workspace");
    for (const open of [openForkDialog, openForkCompactDialog, openMoveGroupDialog, openRenameSessionForm, openRenameGroupDialog]) {
      const dialog = open(ctx)!;
      assert.ok(dialog, open.name);
      consistent(renderFormDialog(dialog, width, ctx, 100), dialog.purpose);
    }
    const draft = openNewSessionDialog(ctx);
    for (const focus of ["repo:0", "worktree", "group"] as const) {
      consistent(renderNewSessionDialog({ ...draft, optionsExpanded: true, form: { ...draft.form, focus } }, width, ctx), `New session ${focus}`);
    }
    consistent(renderNewSessionDialog({ ...draft, actionFocus: "add" }, width, ctx), "New session action");
    const repoPicker = createRepoPicker(["/tmp"]);
    for (const mode of ["recent", "browse"] as const) consistent(renderRepoPicker({ ...repoPicker, mode, dir: "/tmp" }, width, darkTheme, 100), `Repo ${mode}`);
    for (const purpose of ["skills", "mcp"] as const) {
      const picker = createPickerDialog(purpose, [{ name: "Tool", enabled: true }], ctx)!;
      consistent(renderPickerDialog(picker, width, ctx, 100), purpose);
      if (purpose === "skills") consistent(renderPickerDialog({ ...picker, picker: { ...picker.picker, poolInput: createTextInput("/tmp/skills") } }, width, ctx, 100), "Pool path editor");
    }
    consistent(renderThemeDialog(createThemeDialog({ names: ["dark", "light"], setting: "dark", syncPi: true }), width, 100, darkTheme), "Theme");
    consistent(renderArchiveDialog(openArchiveDialog(ctx, selected.id)!, width, ctx), "Archive");
    consistent(renderRestartDialog(createRestartDialog(selected.id), width, 100, ctx).lines, "Restart");
    consistent(renderConfirmDialog(openDeleteDialog(ctx)!, width, 100, ctx).lines, "Delete");
    const worktreeCtx = { ...ctx, controller: new SessionsController({ version: 1, sessions: [{ ...selected, worktreeOwnedByHub: true,
      worktrees: [{ path: "/tmp/wt", repoRoot: "/tmp", branch: "feature", baseBranch: "main", role: "primary" }] }] }) };
    consistent(renderConfirmDialog(openFinishDialog(worktreeCtx)!, width, 100, worktreeCtx).lines, "Finish");
    for (const mode of ["picker", "save"] as const) consistent(renderFavoritesDialog(openFavoritesDialog(draft, ctx, mode), width, ctx), `Favorites ${mode}`);
    const question = createQuestionDialog({ managedId: "one", piSessionId: "pi-one", instanceId: "instance" }, "Session", {
      toolCallId: "call", params: { questions: [{ question: "Which?", header: "Choice", options: [{ label: "First", description: "First option" }] }] },
    });
    consistent([...renderQuestionPanel(question, width, darkTheme).body, renderQuestionPanel(question, width).keyLine], "Question");
    handleQuestionInput(question, "t");
    consistent([...renderQuestionPanel(question, width, darkTheme).body, renderQuestionPanel(question, width).keyLine], "Custom answer");
  });
}

test("phone footers keep the inbox loop instead of duplicating selected-card controls", () => {
  for (const width of [30, 40, 60, 80, 119]) {
    assert.match(dashboardFooter(width), /^\] Next(?: request)? · p Reply · : (?:All actions|Actions)/);
    assert.doesNotMatch(dashboardFooter(width), /Workspace|Enter/);
  }
});
