import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHeartbeat, parseWorkflowEntry, parseWorkflowSnapshot, readHeartbeat } from "../src/core/heartbeat.js";
import { heartbeatPath } from "../src/core/paths.js";

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
  assert.deepEqual(parseHeartbeat({ ...forkCore, operation: { kind: "compact", phase: "running", id: "op-2" } }, "fork")?.operation, {
    kind: "compact",
    phase: "running",
    id: "op-2",
  });
  assert.equal(parseHeartbeat({ ...forkCore, operation: { kind: "compact", phase: "error", id: "op-2" } }, "fork")?.operation, undefined);
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

test("accepts a valid mode without a workflow rail", () => {
  const heartbeat = parseHeartbeat({ ...core, workflow: { activeMode: { id: "focus", short: "FOC", label: "Focus" }, updatedAt: 1_000 } }, "api");
  assert.deepEqual(heartbeat?.activeMode, { id: "focus", short: "FOC", label: "Focus" });
  assert.equal(heartbeat?.workflow, undefined);
});

test("invalid workflow metadata does not hide a valid independent mode", () => {
  const heartbeat = parseHeartbeat({ ...core, workflow: { steps: [], activeIndex: 0, activeMode: { id: "focus", short: "FOC" }, updatedAt: 1_000 } }, "api");
  assert.deepEqual(heartbeat?.activeMode, { id: "focus", short: "FOC" });
  assert.equal(heartbeat?.workflow, undefined);
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
