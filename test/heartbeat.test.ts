import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHeartbeat, parseSessionActivity, parseWorkflowEntry, parseWorkflowSnapshot, readHeartbeat } from "../src/core/heartbeat.js";
import { heartbeatPath } from "../src/core/paths.js";
import { applyComputedStatus } from "../src/core/status.js";
import type { ManagedSession } from "../src/core/types.js";

const core = {
  managedSessionId: "api",
  cwd: "/tmp/api",
  state: "waiting",
  stateSince: 900,
  updatedAt: 1_000,
} as const;

test("parses bounded fork compaction operation phases independently from liveness", () => {
  const forkCore = { ...core, managedSessionId: "fork", state: "running" as const };
  assert.deepEqual(parseHeartbeat({ ...forkCore, operation: { kind: "fork-compact", phase: "running", id: "op-1" } }, "fork")?.operation, {
    kind: "fork-compact",
    phase: "running",
    id: "op-1",
  });
  assert.deepEqual(parseHeartbeat({ ...forkCore, operation: { kind: "fork-compact", phase: "complete", id: "op-1", extra: true } }, "fork")?.operation, {
    kind: "fork-compact",
    phase: "complete",
    id: "op-1",
  });
  assert.equal(parseHeartbeat({ ...forkCore, operation: { kind: "other", phase: "running" } }, "fork")?.operation, undefined);
  assert.equal(parseHeartbeat({ ...forkCore, operation: { kind: "fork-compact", phase: "running", id: "x".repeat(81) } }, "fork")?.operation, undefined);
  assert.equal(parseHeartbeat({ ...forkCore, operation: { kind: "fork-compact", phase: "broken" } }, "fork")?.operation, undefined);
});

test("heartbeat intake normalizes main and child envelopes", () => {
  assert.deepEqual(parseHeartbeat({
    ...core,
    piSessionFile: "/tmp/session.jsonl",
    piSessionId: "pi-1",
    piSessionName: "API session",
    message: "ready",
    unknown: true,
  }, "api"), {
    ...core,
    piSessionFile: "/tmp/session.jsonl",
    piSessionId: "pi-1",
    piSessionName: "API session",
    message: "ready",
  });

  assert.deepEqual(parseHeartbeat({
    ...core,
    managedSessionId: "child",
    kind: "subagent",
    parentId: "api",
    agentName: "scout",
    taskPreview: "Inspect status",
    resultPath: "/tmp/result.md",
    producerField: "ignored",
  }, "child"), {
    ...core,
    managedSessionId: "child",
    kind: "subagent",
    parentId: "api",
    agentName: "scout",
    taskPreview: "Inspect status",
    resultPath: "/tmp/result.md",
  });
});

test("heartbeat intake rejects invalid required envelope data", () => {
  const invalid: unknown[] = [
    undefined,
    null,
    [],
    "heartbeat",
    {},
    { ...core, managedSessionId: undefined },
    { ...core, managedSessionId: "" },
    { ...core, cwd: undefined },
    { ...core, cwd: "" },
    { ...core, state: undefined },
    { ...core, state: "idle" },
    { ...core, stateSince: undefined },
    { ...core, stateSince: -1 },
    { ...core, stateSince: Number.NaN },
    { ...core, updatedAt: undefined },
    { ...core, updatedAt: -1 },
    { ...core, updatedAt: Number.POSITIVE_INFINITY },
  ];
  for (const value of invalid) assert.equal(parseHeartbeat(value, "api"), undefined);
  assert.equal(parseHeartbeat(core, "different"), undefined);
});

test("heartbeat intake omits malformed optional scalars", () => {
  assert.deepEqual(parseHeartbeat({
    ...core,
    piSessionFile: 1,
    piSessionId: false,
    piSessionName: null,
    message: {},
    kind: "worker",
    parentId: 2,
    agentName: [],
    taskPreview: true,
    resultPath: 3,
  }, "api"), core);
});

test("workflow adapters preserve their distinct position contracts", () => {
  const steps = [
    { id: "plan-md", short: "PL", label: "Plan" },
    { id: "execute", short: "EX", label: "Execute" },
  ];
  const decorations = {
    currentStepComplete: true,
    ticketId: "architecture-005",
    activeMode: { id: "focus", short: "FOC", label: "Focus", detail: "turn 2" },
    activity: { id: "review", label: "Reviewing implementation", pass: 2 },
    plan: {
      phase: { title: "Heartbeat parser", index: 1, count: 2 },
      tasks: { completed: 2, total: 3 },
      phases: [{ completed: 2, total: 3 }],
      nextStep: "Route dashboard intake",
    },
  };
  const expected = { steps, activeIndex: 1, ...decorations, updatedAt: 1_000 };

  assert.deepEqual(parseWorkflowEntry({ steps, activeStep: "execute", ...decorations, updatedAt: 1_000 }), expected);
  assert.deepEqual(parseWorkflowSnapshot({ steps, activeIndex: 1, ...decorations, updatedAt: 1_000 }), expected);
  assert.equal(parseWorkflowEntry({ steps, activeIndex: 1, updatedAt: 1_000 }), undefined);
  assert.equal(parseWorkflowSnapshot({ steps, activeStep: "execute", updatedAt: 1_000 }), undefined);
  assert.equal(parseWorkflowEntry({ steps, activeStep: "execute", activeIndex: 1, updatedAt: 1_000 }), undefined);
  assert.equal(parseWorkflowSnapshot({ steps, activeIndex: 1, activeStep: "execute", updatedAt: 1_000 }), undefined);
});

test("heartbeat intake isolates malformed optional metadata", () => {
  const validContext = { version: 1, updatedAt: 1_000, ticket: { id: "architecture-005" }, attention: { requestId: "req-7", kind: "question", text: "Choose rollout" } };
  const validWorkflow = { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 1_000 };
  const validTheme = { name: "midnight", sourcePath: "/tmp/theme.json", tokens: { accent: "#abcdef", border: 12 } };
  assert.deepEqual(parseHeartbeat({ ...core, context: validContext, workflow: validWorkflow, activeTheme: validTheme }, "api"), {
    ...core,
    context: validContext,
    workflow: validWorkflow,
    activeTheme: validTheme,
  });

  const badContext = parseHeartbeat({ ...core, context: { version: 2, updatedAt: 1_000 }, workflow: validWorkflow, activeTheme: validTheme }, "api");
  assert.deepEqual(badContext, { ...core, workflow: validWorkflow, activeTheme: validTheme });

  const badWorkflow = parseHeartbeat({ ...core, context: validContext, workflow: { steps: [], activeIndex: 0, updatedAt: 1_000 }, activeTheme: validTheme }, "api");
  assert.deepEqual(badWorkflow, { ...core, context: validContext, activeTheme: validTheme });

  const badTheme = parseHeartbeat({
    ...core,
    context: validContext,
    workflow: validWorkflow,
    activeTheme: { name: 1, sourcePath: false, tokens: { accent: "#abcdef", warning: Number.NaN, unknown: "ignored" } },
  }, "api");
  assert.deepEqual(badTheme, { ...core, context: validContext, workflow: validWorkflow, activeTheme: { tokens: { accent: "#abcdef" } } });
});

test("invalid workflow decorations do not hide a valid base snapshot", () => {
  const workflow = parseWorkflowSnapshot({
    steps: [{ id: "execute", short: "EX" }],
    activeIndex: 0,
    updatedAt: 1_000,
    activeMode: { id: "focus", short: 2 },
    activity: { id: "review", label: "" },
    plan: { tasks: { completed: 4, total: 2 } },
  });
  assert.deepEqual(workflow, {
    steps: [{ id: "execute", short: "EX" }],
    activeIndex: 0,
    updatedAt: 1_000,
  });
});

test("readHeartbeat treats missing, malformed, invalid, and mismatched files as absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-heartbeat-intake-"));
  const env = { PI_AGENT_HUB_DIR: root };
  try {
    await mkdir(join(root, "heartbeats"));
    assert.equal(await readHeartbeat("missing", env), undefined);

    await writeFile(heartbeatPath("api", env), "not json", "utf8");
    assert.equal(await readHeartbeat("api", env), undefined);

    await writeFile(heartbeatPath("api", env), JSON.stringify({ ...core, state: "idle" }), "utf8");
    assert.equal(await readHeartbeat("api", env), undefined);

    await writeFile(heartbeatPath("api", env), JSON.stringify({ ...core, managedSessionId: "other" }), "utf8");
    assert.equal(await readHeartbeat("api", env), undefined);

    await writeFile(heartbeatPath("api", env), JSON.stringify(core), "utf8");
    assert.deepEqual(await readHeartbeat("api", env), core);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readHeartbeat surfaces unexpected filesystem errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-heartbeat-error-"));
  const stateFile = join(root, "state-file");
  try {
    await writeFile(stateFile, "not a directory", "utf8");
    await assert.rejects(readHeartbeat("api", { PI_AGENT_HUB_DIR: stateFile }), (error: NodeJS.ErrnoException) => error.code === "ENOTDIR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interaction capability is small and independently validated", () => {
  const value = { version: 1, instanceId: "instance-1", pending: ["never heartbeat this"] };
  assert.deepEqual(parseHeartbeat({ ...core, interaction: value }, "api")?.interaction, { version: 1, instanceId: "instance-1" });
  for (const interaction of [null, {}, { version: 2, instanceId: "x" }, { version: 1, instanceId: "../bad" }, { version: 1, instanceId: "x".repeat(129) }]) {
    const parsed = parseHeartbeat({ ...core, interaction }, "api");
    assert.equal(parsed?.state, "waiting");
    assert.equal(parsed?.interaction, undefined);
  }
});

test("live tool activity is bounded, sanitized, and drops malformed entries", () => {
  const recent = Array.from({ length: 8 }, (_, index) => ({ tool: `tool-${index}`, at: 900 - index }));
  const activity = parseSessionActivity({
    current: { tool: " bash\u001b[31m ", detail: "npm\n test\u0007 --watch", at: 950, extra: true },
    recent: [{ tool: "read", detail: "x".repeat(101), at: 940 }, { tool: "edit", at: -1 }, { detail: "no tool", at: 930 }, "noise", ...recent],
  });
  // Control characters become spaces and collapse; a detail over 100 characters is dropped, not the action.
  assert.deepEqual(activity?.current, { tool: "bash", detail: "npm test --watch", at: 950 });
  // Only the first six entries are read; malformed ones among them are dropped, never replaced by later ones.
  assert.deepEqual(activity?.recent, [{ tool: "read", at: 940 }, { tool: "tool-0", at: 900 }, { tool: "tool-1", at: 899 }]);
  assert.deepEqual(parseSessionActivity({ recent: recent.slice(0, 6) })?.recent?.length, 6);
  assert.deepEqual(parseSessionActivity({ recent })?.recent?.map((action) => action.tool), recent.slice(0, 6).map((action) => action.tool));
  assert.equal(parseSessionActivity({ current: { tool: "t".repeat(41), at: 1 } }), undefined, "a tool name over 40 characters drops the action");
  assert.deepEqual(parseSessionActivity({ current: { tool: "t".repeat(40), detail: "d".repeat(100), at: 1 } })?.current, { tool: "t".repeat(40), detail: "d".repeat(100), at: 1 });
  assert.equal(parseSessionActivity({ current: { tool: "\u0000\u001f", at: 1 } }), undefined);
  assert.equal(parseSessionActivity({ current: { tool: "bash" } }), undefined, "an action needs its time");
  assert.equal(parseSessionActivity({ recent: "bash" }), undefined);
  assert.equal(parseSessionActivity(undefined), undefined);
});

test("heartbeat activity round-trips and a malformed one is isolated", () => {
  const activity = { current: { tool: "bash", detail: "npm test", at: 950 }, recent: [{ tool: "read", detail: "src/a.ts", at: 940 }] };
  assert.deepEqual(parseHeartbeat(JSON.parse(JSON.stringify({ ...core, activity })), "api")?.activity, activity);
  const malformed = parseHeartbeat({ ...core, activity: { current: { tool: 3, at: 1 }, recent: [{}] } }, "api");
  assert.equal(malformed?.activity, undefined);
  assert.equal(malformed?.state, "waiting");
});

test("plan phase titles parse and a producer checklist is ignored", () => {
  const base = { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 1_000 };
  const plan = (extra: Record<string, unknown>) => parseWorkflowSnapshot({ ...base, plan: { tasks: { completed: 1, total: 3 }, ...extra } })?.plan;
  assert.deepEqual(plan({
    current: { tasks: [{ done: true, text: "Write tests" }, { done: false, text: "Ship" }], before: 4, after: 2 },
    phases: [{ completed: 1, total: 2, title: "Parsers" }, { completed: 0, total: 1, title: "x".repeat(161) }],
  }), {
    tasks: { completed: 1, total: 3 },
    phases: [{ completed: 1, total: 2, title: "Parsers" }, { completed: 0, total: 1 }],
  });
});

const LENS = {
  doing: " Add at in\u001b[31m src/core/conversation.ts ",
  stages: [{ label: "1", state: "done" }, { label: "2", state: "active" }, { label: "3", state: "pending" }],
  progress: { completed: 11, total: 19, unit: "tasks" },
  pass: 2,
  list: {
    label: "PLAN", head: "Conversation transport",
    items: [{ state: "done", text: "conversation test" }, { state: "active", text: "Add at" }, { state: "pending", text: "web-server test" }, { state: "attention", text: "Fix" }, { state: "skipped", text: "Drop" }],
    before: 1, after: 2,
  },
};

test("workflow lens parses every bounded field from any step", () => {
  const base = { steps: [{ id: "build", short: "BLD" }], activeIndex: 0, updatedAt: 1_000 };
  assert.deepEqual(parseWorkflowSnapshot({ ...base, lens: LENS })?.lens, {
    ...LENS,
    doing: "Add at in src/core/conversation.ts",
  });
  assert.deepEqual(parseWorkflowEntry({ steps: [{ id: "build", short: "BLD" }], activeStep: "build", updatedAt: 1_000, lens: { doing: "Build" } })?.lens, { doing: "Build" });
  assert.equal(parseWorkflowSnapshot({ ...base, lens: {} })?.lens, undefined);
  assert.equal(parseWorkflowSnapshot({ ...base, lens: "doing" })?.lens, undefined);
});

test("one malformed lens field is dropped without hiding the rest or the rail", () => {
  const base = { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 1_000 };
  const lens = (field: string, value: unknown) => parseWorkflowSnapshot({ ...base, lens: { ...LENS, [field]: value } });
  const item = (text: string, state = "active") => ({ ...LENS.list, items: [{ state, text }] });
  const malformed: Array<[string, unknown]> = [
    ["doing", "d".repeat(161)], ["doing", " "], ["doing", 3],
    ["stages", [{ label: "x".repeat(25), state: "done" }]], ["stages", [{ label: "1", state: "attention" }]],
    ["stages", Array.from({ length: 13 }, () => ({ label: "1", state: "done" }))], ["stages", []],
    ["progress", { completed: 3, total: 2 }], ["progress", { completed: 1, total: 2, unit: "u".repeat(17) }],
    ["pass", 1], ["pass", 2.5], ["pass", "2"],
    ["list", { ...LENS.list, label: "PLANNED" }], ["list", { ...LENS.list, label: "計画計画" }],
    ["list", { ...LENS.list, head: "h".repeat(121) }], ["list", { ...LENS.list, items: [] }],
    ["list", { ...LENS.list, items: Array.from({ length: 13 }, () => ({ state: "done", text: "x" })) }],
    ["list", item("t".repeat(121))], ["list", item("ok", "open")], ["list", { ...LENS.list, before: -1 }],
  ];
  for (const [field, value] of malformed) {
    const parsed = lens(field, value);
    assert.equal(parsed?.activeIndex, 0, field);
    assert.equal(field in (parsed?.lens ?? {}), false, `${field}: ${JSON.stringify(value).slice(0, 40)}`);
    assert.ok(Object.keys(parsed?.lens ?? {}).length >= 4, field);
  }
  assert.equal(lens("list", { ...LENS.list, label: "計画" })?.lens?.list?.label, "計画");
  assert.deepEqual(lens("progress", { completed: 1, total: 2 })?.lens?.progress, { completed: 1, total: 2 });
});

test("computed status retains the lens and keeps tool activity out of the registry", () => {
  const now = 10_000;
  const session: ManagedSession = { id: "api", title: "api", cwd: "/tmp/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "running", createdAt: 1, updatedAt: 1 };
  const heartbeat = parseHeartbeat({
    ...core, state: "running", stateSince: now - 100, updatedAt: now,
    activity: { current: { tool: "bash", at: now } },
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: now,
      plan: { tasks: { completed: 1, total: 2 } }, lens: { doing: "Two", progress: { completed: 1, total: 2 } } },
  }, "api")!;
  const updated = applyComputedStatus(session, { status: "running" }, now, heartbeat);
  assert.deepEqual(updated.workflow?.lens, { doing: "Two", progress: { completed: 1, total: 2 } });
  assert.equal("activity" in updated, false);
  const stale = applyComputedStatus({ ...updated, status: "stopped" }, { status: "stopped" }, now + 60_000, { ...heartbeat, updatedAt: 0, workflow: undefined });
  assert.deepEqual(stale.workflow?.lens, { doing: "Two", progress: { completed: 1, total: 2 } });
});
