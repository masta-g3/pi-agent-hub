import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piAgentHubExtension from "../src/extension/index.js";
import { SESSION_ID_ENV, STATE_ENV } from "../src/core/names.js";
import { heartbeatPath } from "../src/core/paths.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { stripAnsi } from "../src/tui/theme.js";
import type { Heartbeat, RuntimeSession } from "../src/core/types.js";

const EXTENSION_KEY = Symbol.for("pi-agent-hub.extension.loaded");
const STEPS = [
  { id: "draft", short: "DR", label: "Draft" },
  { id: "build", short: "BL", label: "Build" },
  { id: "check", short: "CK", label: "Check" },
  { id: "polish", short: "PO", label: "Polish" },
  { id: "ship", short: "SH", label: "Ship" },
];

test("producer-neutral entries carry completion through heartbeat, lanes, and cards", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-completion-integration-"));
  const previousId = process.env[SESSION_ID_ENV];
  const previousState = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "completion-integration";
  process.env[STATE_ENV] = root;
  const branch: unknown[] = [];
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
    getSessionName() { return "Neutral Workflow"; },
  };
  const ctx = { cwd: "/repo", hasUI: false, sessionManager: { getBranch: () => branch } };
  const publish = async (activeStep: string, currentStepComplete: boolean, label: string, updatedAt: number) => {
    branch.push({ type: "custom", customType: "workflow-runtime", data: {
      activeStep, currentStepComplete, updatedAt, steps: STEPS,
      activity: { id: `state-${updatedAt}`, label },
    } });
    await handlers.get("session_info_changed")?.({}, ctx);
    const heartbeat = JSON.parse(await readFile(heartbeatPath("completion-integration", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    const session: RuntimeSession = {
      id: "completion-integration", title: "Neutral Workflow", cwd: "/repo", group: "neutral",
      tmuxSession: "pi-agent-hub-completion", status: "waiting", createdAt: 1, updatedAt: 1,
      workflow: heartbeat.workflow,
    };
    const model = buildRenderModel({ sessions: [session], selectedId: session.id, grouping: "stage", width: 100 });
    return { heartbeat, model, text: renderSessions(model).lines.map(stripAnsi).join("\n") };
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    const cases = [
      ["check", false, "Checking changes", "◉CK", "check"],
      ["check", true, "Check complete", "✓CK", "check"],
      ["polish", false, "Polishing result", "◉PO", "polish"],
      ["ship", true, "Ship complete", "✓SH", "ship"],
    ] as const;
    for (const [step, complete, label, marker, lane] of cases) {
      const result = await publish(step, complete, label, branch.length + 1);
      assert.equal(result.heartbeat.workflow?.currentStepComplete, complete);
      assert.equal(result.model.sections[0]?.key, lane);
      assert.match(result.text, new RegExp(`${marker}[\\s\\S]*${label}`));
    }

    const replacement = await publish("draft", false, "Starting next workflow", branch.length + 1);
    assert.equal(replacement.model.sections[0]?.key, "draft");
    assert.match(replacement.text, /◉DR[\s\S]*Starting next workflow/);
    assert.doesNotMatch(replacement.text, /✓SH/);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousId === undefined) delete process.env[SESSION_ID_ENV]; else process.env[SESSION_ID_ENV] = previousId;
    if (previousState === undefined) delete process.env[STATE_ENV]; else process.env[STATE_ENV] = previousState;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
    await rm(root, { recursive: true, force: true });
  }
});
