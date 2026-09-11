import { parseForkPreparation } from "../core/fork-preparation.js";
import type { ForkPreparation } from "../core/types.js";

export const FORK_PREPARATION_ENTRY = "pi-agent-hub-fork-preparation";
export const WORKFLOW_RESET_ENTRY = "workflow-runtime-reset";
export const WORKFLOW_RESET_CAPABILITY = Symbol.for("pi-agent-hub.workflow-reset.v1");
export const RESET_CONFIRMATION_TIMEOUT_MS = 5_000;
export const RESET_CONFIRMATION_ERROR = "Task reset was not confirmed; update the workflow extension or retry";

const FORK_ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const CHECKPOINT_ID_MAX_LENGTH = 128;

export interface ForkPreparationCheckpoint {
  version: 1;
  managedSessionId: string;
  piSessionId: string;
  preparation: ForkPreparation;
}

export function parseForkAttempt(value: string | undefined): string | undefined {
  const attempt = value?.trim();
  return attempt && FORK_ATTEMPT_PATTERN.test(attempt) ? attempt : undefined;
}

export function resetReceiptMatches(data: unknown, attemptId: string): boolean {
  if (!data || typeof data !== "object") return false;
  const receipt = data as Record<string, unknown>;
  return receipt.version === 1 && receipt.id === attemptId && receipt.status === "ready";
}

export function parsePreparationCheckpoint(data: unknown): ForkPreparationCheckpoint | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = data as Record<string, unknown>;
  const managedSessionId = checkpointId(value.managedSessionId);
  const piSessionId = checkpointId(value.piSessionId);
  const preparation = parseForkPreparation(value.preparation);
  if (value.version !== 1 || !managedSessionId || !piSessionId || !preparation) return undefined;
  return { version: 1, managedSessionId, piSessionId, preparation };
}

function checkpointId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id && id.length <= CHECKPOINT_ID_MAX_LENGTH ? id : undefined;
}

export function isNoWorkCompactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "Nothing to compact (session too small)" || message === "Already compacted";
}
