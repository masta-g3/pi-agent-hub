import { readJsonOr } from "./atomic-json.js";
import { heartbeatPath } from "./paths.js";
import { parseSessionContext } from "./session-context.js";
import type {
  ActiveThemeSnapshot,
  ActiveThemeToken,
  Heartbeat,
  SessionPlanSummary,
  WorkflowActivityDisplay,
  WorkflowModeDisplay,
  WorkflowRuntimeSnapshot,
  WorkflowStep,
  HeartbeatOperation,
} from "./types.js";

const HEARTBEAT_STATES: Heartbeat["state"][] = ["starting", "running", "waiting", "error", "shutdown"];
const THEME_TOKENS: ActiveThemeToken[] = ["accent", "success", "warning", "error", "muted", "dim", "text", "border", "statusLineBg", "selectedBg"];
const PLAN_TASK_MAX = 10_000;

export async function readHeartbeat(sessionId: string, env: NodeJS.ProcessEnv = process.env): Promise<Heartbeat | undefined> {
  try {
    const value = await readJsonOr<unknown>(heartbeatPath(sessionId, env), undefined);
    return parseHeartbeat(value, sessionId);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function parseHeartbeat(value: unknown, expectedSessionId: string): Heartbeat | undefined {
  if (!isObject(value)) return undefined;
  const managedSessionId = requiredString(value.managedSessionId);
  const cwd = requiredString(value.cwd);
  if (!managedSessionId || managedSessionId !== expectedSessionId || !cwd) return undefined;
  if (typeof value.state !== "string" || !HEARTBEAT_STATES.includes(value.state as Heartbeat["state"])) return undefined;
  if (!nonnegativeFinite(value.stateSince) || !nonnegativeFinite(value.updatedAt)) return undefined;

  const context = parseSessionContext(value.context);
  const workflow = parseWorkflowSnapshot(value.workflow);
  const activeTheme = parseActiveTheme(value.activeTheme);
  const operation = parseHeartbeatOperation(value.operation);
  return {
    managedSessionId,
    ...optionalStringField("piSessionFile", value.piSessionFile),
    ...optionalStringField("piSessionId", value.piSessionId),
    cwd,
    state: value.state as Heartbeat["state"],
    stateSince: value.stateSince,
    ...optionalStringField("message", value.message),
    updatedAt: value.updatedAt,
    ...(operation ? { operation } : {}),
    ...(value.kind === "main" || value.kind === "subagent" ? { kind: value.kind } : {}),
    ...optionalStringField("parentId", value.parentId),
    ...optionalStringField("agentName", value.agentName),
    ...optionalStringField("taskPreview", value.taskPreview),
    ...optionalStringField("resultPath", value.resultPath),
    ...(activeTheme ? { activeTheme } : {}),
    ...optionalStringField("piSessionName", value.piSessionName),
    ...(context ? { context } : {}),
    ...(workflow ? { workflow } : {}),
  };
}

export function parseWorkflowEntry(value: unknown): WorkflowRuntimeSnapshot | undefined {
  if (!isObject(value) || "activeIndex" in value || typeof value.activeStep !== "string" || !value.activeStep.trim()) return undefined;
  const steps = parseWorkflowSteps(value.steps);
  if (!steps) return undefined;
  const activeIndex = steps.findIndex((step) => step.id === value.activeStep);
  return activeIndex < 0 ? undefined : workflowSnapshot(value, steps, activeIndex);
}

export function parseWorkflowSnapshot(value: unknown): WorkflowRuntimeSnapshot | undefined {
  if (!isObject(value) || "activeStep" in value) return undefined;
  const steps = parseWorkflowSteps(value.steps);
  if (!steps || !Number.isInteger(value.activeIndex) || (value.activeIndex as number) < 0 || (value.activeIndex as number) >= steps.length) return undefined;
  return workflowSnapshot(value, steps, value.activeIndex as number);
}

function workflowSnapshot(data: Record<string, unknown>, steps: WorkflowStep[], activeIndex: number): WorkflowRuntimeSnapshot | undefined {
  if (typeof data.updatedAt !== "number" || !Number.isFinite(data.updatedAt)) return undefined;
  const ticketId = typeof data.ticketId === "string" ? data.ticketId.trim() : "";
  const currentStepComplete = typeof data.currentStepComplete === "boolean" ? data.currentStepComplete : undefined;
  const activeMode = parseWorkflowMode(data.activeMode);
  const activity = parseWorkflowActivity(data.activity);
  const plan = parseWorkflowPlan(data.plan);
  return {
    steps,
    activeIndex,
    ...(currentStepComplete !== undefined ? { currentStepComplete } : {}),
    ...(activeMode ? { activeMode } : {}),
    ...(activity ? { activity } : {}),
    ...(plan ? { plan } : {}),
    ...(ticketId ? { ticketId } : {}),
    updatedAt: data.updatedAt,
  };
}

function parseWorkflowSteps(value: unknown): WorkflowStep[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const steps: WorkflowStep[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.short !== "string") return undefined;
    const id = item.id.trim();
    const short = item.short.trim();
    if (!id || !short || ids.has(id)) return undefined;
    if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) return undefined;
    ids.add(id);
    steps.push({ id, short, ...(typeof item.label === "string" ? { label: item.label.trim() } : {}) });
  }
  return steps;
}

function parseWorkflowMode(value: unknown): WorkflowModeDisplay | undefined {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.short !== "string") return undefined;
  const id = value.id.trim();
  const short = value.short.trim();
  if (!id || !short) return undefined;
  if (value.label !== undefined && (typeof value.label !== "string" || !value.label.trim())) return undefined;
  if (value.detail !== undefined && (typeof value.detail !== "string" || !value.detail.trim())) return undefined;
  return {
    id,
    short,
    ...(typeof value.label === "string" ? { label: value.label.trim() } : {}),
    ...(typeof value.detail === "string" ? { detail: value.detail.trim() } : {}),
  };
}

function parseWorkflowActivity(value: unknown): WorkflowActivityDisplay | undefined {
  if (!isObject(value)) return undefined;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!id || !label || [...id].length > 80 || [...label].length > 120) return undefined;
  const pass = value.pass;
  if (pass !== undefined && (!Number.isInteger(pass) || (pass as number) < 1 || (pass as number) > 999)) return undefined;
  return { id, label, ...(typeof pass === "number" ? { pass } : {}) };
}

function parseWorkflowPlan(value: unknown): SessionPlanSummary | undefined {
  if (!isObject(value)) return undefined;
  const tasks = parseCount(value.tasks);
  const phase = isObject(value.phase) ? value.phase : undefined;
  const title = phase && typeof phase.title === "string" ? phase.title.trim() : "";
  const index = phase?.index;
  const count = phase?.count;
  const parsedPhase = title && positiveInt(index) && positiveInt(count) && index <= count && [...title].length <= 160 ? { title, index, count } : undefined;
  const phases = Array.isArray(value.phases) && value.phases.length <= 100 ? value.phases.map(parseCount) : undefined;
  const parsedPhases = phases?.every(Boolean) ? phases as { completed: number; total: number }[] : undefined;
  const validPhases = parsedPhases && parsedPhases.reduce((sum, item) => sum + item.total, 0) <= PLAN_TASK_MAX ? parsedPhases : undefined;
  const nextStep = typeof value.nextStep === "string" && value.nextStep.trim() && [...value.nextStep.trim()].length <= 240 ? value.nextStep.trim() : undefined;
  const plan = {
    ...(parsedPhase ? { phase: parsedPhase } : {}),
    ...(tasks ? { tasks } : {}),
    ...(validPhases?.length ? { phases: validPhases } : {}),
    ...(nextStep ? { nextStep } : {}),
  };
  return Object.keys(plan).length ? plan : undefined;
}

function parseCount(value: unknown): { completed: number; total: number } | undefined {
  if (!isObject(value)) return undefined;
  return nonnegativeInt(value.completed) && nonnegativeInt(value.total) && value.completed <= value.total
    ? { completed: value.completed, total: value.total }
    : undefined;
}

function parseHeartbeatOperation(value: unknown): HeartbeatOperation | undefined {
  if (!isObject(value) || value.kind !== "fork-compact" || (value.phase !== "running" && value.phase !== "complete" && value.phase !== "error")) return undefined;
  const id = requiredString(value.id);
  return id && [...id].length <= 80 ? { kind: "fork-compact", phase: value.phase, id } : undefined;
}

function parseActiveTheme(value: unknown): ActiveThemeSnapshot | undefined {
  if (!isObject(value)) return undefined;
  const name = nonemptyString(value.name);
  const sourcePath = nonemptyString(value.sourcePath);
  const tokens: NonNullable<ActiveThemeSnapshot["tokens"]> = {};
  if (isObject(value.tokens)) {
    for (const token of THEME_TOKENS) {
      const tokenValue = value.tokens[token];
      if (typeof tokenValue === "string" || (typeof tokenValue === "number" && Number.isFinite(tokenValue))) tokens[token] = tokenValue;
    }
  }
  return name || sourcePath || Object.keys(tokens).length
    ? { ...(name ? { name } : {}), ...(sourcePath ? { sourcePath } : {}), ...(Object.keys(tokens).length ? { tokens } : {}) }
    : undefined;
}

function optionalStringField<K extends keyof Heartbeat>(key: K, value: unknown): Partial<Pick<Heartbeat, K>> {
  return typeof value === "string" ? { [key]: value } as Partial<Pick<Heartbeat, K>> : {};
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 100;
}

function nonnegativeInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= PLAN_TASK_MAX;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
