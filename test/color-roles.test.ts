import assert from "node:assert/strict";
import test from "node:test";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { createRepoPicker, renderRepoPicker } from "../src/tui/repo-picker.js";
import { createThemeDialog, renderThemeDialog } from "../src/tui/theme-dialog.js";
import type { RuntimeSession } from "../src/core/types.js";
import { createCommandPalette, renderCommandPalette } from "../src/tui/command-palette-dialog.js";
import { renderConversationPane } from "../src/tui/conversation.js";
import { buildDashboardCommands, selectWorkspaceCommands, type DashboardCommand } from "../src/tui/dashboard-commands.js";
import { renderForm, renderSessions } from "../src/tui/layout.js";
import { createQuestionDialog, handleQuestionInput, renderQuestionDialog } from "../src/tui/question-dialog.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";

const theme = { ...darkTheme, dim: "#010203", muted: "#040506", error: "#070809" };
const dimCode = styleToken(theme, "dim", "x").split("x")[0]!;

function spans(text: string, token: "dim" | "muted" | "error"): string[] {
  const code = styleToken(theme, token, "x").split("x")[0]!;
  return text.split(code).slice(1).map(part => part.split("\u001b")[0]!);
}

function decorationOnly(lines: readonly string[]): void {
  for (const span of spans(lines.join("\n"), "dim")) {
    assert.match(span, /^[│└├─·\[\] ]*$/u, `Informational dim span: ${JSON.stringify(span)}`);
  }
}

const steps = [
  { id: "plan", short: "PL", label: "Plan" },
  { id: "execute", short: "EX", label: "Execute" },
  { id: "review", short: "RV", label: "Review" },
];
function session(id: string, values: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title: `Session ${id}`, cwd: "/tmp/api", group: "team", tmuxSession: `pi-agent-hub-${id}`,
    status: "idle", createdAt: 1, updatedAt: 1, lastActivityAt: 1,
    workflow: { steps, activeIndex: 1, updatedAt: 1,
      plan: { tasks: { completed: 1, total: 3 }, nextStep: "Check the next task" } },
    ...values,
  };
}
const sessions = [
  session("request", { status: "waiting", context: { version: 1, updatedAt: 1,
    ticket: { id: "t1", subtitle: "A complete task subtitle" },
    attention: { kind: "question", text: "Which option?", requestId: "r1", recommendation: "Use the first option", artifact: "/tmp/answer.md" } } }),
  session("health", { status: "error", error: "Pi exited" }),
  session("active", { status: "running", additionalCwds: ["/tmp/docs"], worktreePath: "/tmp/api", worktreeBranch: "feature" }),
  session("child", { kind: "subagent", parentId: "active", agentName: "reviewer", taskPreview: "Review code" }),
  session("quiet"),
  session("backlog", { bucket: "backlog" }),
  ...Array.from({ length: 7 }, (_, index) => session(`archive${index}`, { bucket: "archived", bucketChangedAt: 100 + index })),
];

for (const width of [40, 80, 120, 160]) {
  test(`${width}-column repository picker paths use muted, not dim`, () => {
    const lines = renderRepoPicker(createRepoPicker(["/tmp/api", "/tmp/docs"]), width, theme, 18);
    decorationOnly(lines);
    assert.ok(spans(lines.join("\n"), "muted").some(span => span.includes("/tmp/api")));
  });

  test(`${width}-column confirmation controls use muted, not dim`, () => {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("one")] }), () => {},
      { terminalRows: () => 24, deleteSession: () => {} }, theme);
    view.render(width);
    view.handleInput("d");
    const lines = view.render(width);
    assert.match(stripAnsi(lines.join("\n")), /Esc Cancel/);
    decorationOnly(lines);
    assert.ok(spans(lines.join("\n"), "muted").some(span => span.includes("Esc Cancel")));
  });

  test(`${width}-column Help and resize hints use readable colors`, () => {
    for (const height of [1, 2, 12, 300]) {
      const view = new SessionsView(new SessionsController(), () => {}, { terminalRows: () => height }, theme);
      view.handleInput("?");
      const lines = view.render(width);
      assert.match(stripAnsi(lines.join("\n")), /[Hh]elp/);
      decorationOnly(lines);
    }
  });

  test(`${width}-column theme picker overflow uses readable colors`, () => {
    const dialog = createThemeDialog({ names: ["dark", "light", ...Array.from({ length: 20 }, (_, i) => `theme-${i}`)], setting: "theme-10", syncPi: true });
    const lines = renderThemeDialog(dialog, width, 14, theme);
    assert.match(stripAnsi(lines.join("\n")), /…/);
    decorationOnly(lines);
  });
}

for (const width of [80, 120, 160]) {
  for (const grouping of ["project", "stage"] as const) {
    test(`${width}-column ${grouping} dashboard uses dim only for decoration`, () => {
      const selected = sessions[0]!;
      const commands = buildDashboardCommands({ sessions, selectedId: selected.id, capabilities: { openSession: true } });
      const model = buildRenderModel({ sessions, selectedId: selected.id, width, height: 80, now: 300_000, grouping,
        expandedProjectParentIds: new Set(["active"]), expandedBoardParentIds: new Set(["active"]),
        workspaceCommands: selectWorkspaceCommands(selected, commands, 3) });
      const layout = renderSessions(model, theme);
      decorationOnly(layout.lines);
      assert.match(layout.lines.map(stripAnsi).join("\n"), /Session request/);
      if (grouping === "project") {
        for (const label of ["NEEDS YOU", "HEALTH", "ACTIVE", "QUIET", "ARCHIVED"]) {
          assert.match(layout.lines.map(stripAnsi).join("\n"), new RegExp(label));
        }
      }
      assert.ok(layout.footerItems.length > 0);
    });
  }

  test(`${width}-column selected owner tree contains no dim spans`, () => {
    // No workspace: each painted line belongs solely to the selected owner tree.
    for (const selectedId of ["active", "child"]) {
      const layout = renderSessions(buildRenderModel({ sessions, selectedId, width, height: 60, now: 300_000,
        expandedProjectParentIds: new Set(["active"]) }), theme);
      const painted = layout.lines.filter(line => line.includes("\u001b[48;2;51;64;94m"));
      assert.ok(painted.length > 1);
      for (const line of painted) assert.ok(!line.includes(dimCode), stripAnsi(line));
    }
  });

  test(`${width}-column full-screen workspace and forms keep information readable`, () => {
    const selected = sessions[0]!;
    const commands = buildDashboardCommands({ sessions, selectedId: selected.id, capabilities: { openSession: true } });
    const model = buildRenderModel({ sessions, selectedId: selected.id, width, height: 40, now: 300_000,
      workspaceFullScreen: true, workspaceCommands: selectWorkspaceCommands(selected, commands, 3) });
    decorationOnly(renderSessions(model, theme).lines);
    decorationOnly(renderForm({ title: "Details", focus: "name", footer: "Enter Save · Esc Cancel", fields: [
      { key: "name", label: "Name", value: "Session", hint: "Choose a name" },
      { key: "repo", label: "Repo", value: "/tmp/api", readonly: true },
    ] }, width, theme));
  });

  test(`${width}-column palette disabled rows are muted, not errors`, () => {
    const commands: DashboardCommand[] = [
      { id: "open", group: "actions", label: "Open", hint: "Open the session", displayKey: "Enter", bindings: [], enabled: true, searchText: "open" },
      { id: "rename", group: "actions", label: "Rename", hint: "Change the name", displayKey: "R", bindings: [], enabled: false, disabledReason: "session is stopped", searchText: "rename" },
    ];
    for (const selected of [0, 1]) {
      const rendered = renderCommandPalette({ ...createCommandPalette(), selected }, commands, width, 16, theme);
      decorationOnly(rendered.lines);
      const disabled = rendered.lines.find((_, index) => rendered.rowTargets[index]?.commandId === "rename")!;
      const muted = spans(disabled, "muted");
      assert.ok(muted.includes("R"));
      assert.ok(muted.includes("Rename"));
      assert.ok(muted.includes("session is stopped"));
      assert.equal(spans(rendered.lines.join("\n"), "error").length, 0);
      const selectedLine = rendered.lines.find((_, index) => rendered.rowTargets[index]?.commandId === commands[selected]!.id)!;
      assert.ok(!selectedLine.includes(dimCode));
      assert.ok(selectedLine.includes("\u001b[48;2;51;64;94m"));
    }
  });

  test(`${width}-column question and conversation frames keep hints and status readable`, () => {
    const dialog = createQuestionDialog({ managedId: "m", piSessionId: "p", instanceId: "i" }, "Session", {
      toolCallId: "call", params: { questions: [{ question: "Read [the guide](https://example.com) first. Which?", header: "Choice",
        options: [{ label: "First", description: "First option", hasPreview: true }] }] },
    });
    decorationOnly(renderQuestionDialog(dialog, width, 16, theme));
    handleQuestionInput(dialog, "t");
    decorationOnly(renderQuestionDialog(dialog, width, 16, theme));
    decorationOnly(renderConversationPane({ width, height: 10, title: "Session conversation", transcript: [],
      transcriptHeight: 3, status: "Connected", actions: [], focusedAction: "" }, theme).lines);
  });
}
