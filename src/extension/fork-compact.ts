const CONTEXT_ENTRY = "pi-agent-hub-context";
const WORKFLOW_ENTRY = "workflow-runtime";
const RESET_ENTRY = "workflow-runtime-reset";

type Entry = { type?: unknown; customType?: unknown; data?: unknown };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clearedContext(value: unknown): boolean {
  return object(value) && value.version === 1 && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && value.ticket === undefined && value.attention === undefined;
}

function clearedWorkflow(value: unknown): boolean {
  return object(value) && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && ["ticketId", "activeStep", "plan", "execution", "activity", "activityPasses", "currentStepComplete", "activeMode"]
      .every((field) => value[field] === undefined);
}

export function forkResetReady(entries: readonly unknown[], attempt: string): boolean {
  let context: unknown;
  let workflow: unknown;
  let confirmed = false;
  for (const value of entries) {
    if (!object(value)) continue;
    const entry: Entry = value;
    if (entry.type !== "custom") continue;
    if (entry.customType === CONTEXT_ENTRY) context = entry.data;
    else if (entry.customType === WORKFLOW_ENTRY) workflow = entry.data;
    else if (entry.customType === RESET_ENTRY && object(entry.data)
      && entry.data.version === 1 && entry.data.id === attempt && entry.data.status === "ready") {
      confirmed = clearedContext(context) && clearedWorkflow(workflow);
    }
  }
  return confirmed && clearedContext(context) && clearedWorkflow(workflow);
}
