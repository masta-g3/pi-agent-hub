import type { ForkPreparation, Heartbeat, ManagedSession } from "./types.js";

const MAX_ID_LENGTH = 80;
const MAX_ERROR_LENGTH = 500;

export type PreparationPresence = "present" | "missing" | "unknown";

export function parseForkPreparation(value: unknown): ForkPreparation | undefined {
  if (!isObject(value)) return undefined;
  const id = boundedString(value.id, MAX_ID_LENGTH);
  if (!id || !isPhase(value.phase)) return undefined;
  const launchConfirmed = typeof value.launchConfirmed === "boolean" ? value.launchConfirmed : undefined;
  const launchDeadline = nonnegativeFinite(value.launchDeadline) ? value.launchDeadline : undefined;
  const outcome = value.outcome === "compacted" || value.outcome === "not-needed" ? value.outcome : undefined;
  const error = boundedString(value.error, MAX_ERROR_LENGTH);
  if (value.phase === "ready" && !outcome) return undefined;
  return {
    id,
    phase: value.phase,
    ...(launchConfirmed !== undefined ? { launchConfirmed } : {}),
    ...(launchDeadline !== undefined ? { launchDeadline } : {}),
    ...(outcome ? { outcome } : {}),
    ...(error ? { error } : {}),
  };
}

export function isForkPreparationPending(preparation?: ForkPreparation): boolean {
  return preparation?.phase === "preparing" || preparation?.phase === "compacting";
}

export function forkPreparationMessage(preparation?: ForkPreparation): string | undefined {
  if (preparation?.phase === "preparing") return "Preparing fork";
  if (preparation?.phase === "compacting") return "Compacting";
  if (preparation?.phase === "error") return preparation.error || "Preparation failed";
  return undefined;
}

/** Reconcile one exact preparation attempt with observed process state. */
export function reconcileForkPreparation(
  session: ManagedSession,
  heartbeat: Heartbeat | undefined,
  presence: PreparationPresence,
  now = Date.now(),
): ForkPreparation | undefined {
  const current = session.forkPreparation;
  if (!current || current.phase === "ready" || current.phase === "error") return current;

  const reported = heartbeat?.forkPreparation?.id === current.id ? heartbeat.forkPreparation : undefined;
  if (reported?.phase === "ready" || reported?.phase === "error") {
    return { ...reported, launchConfirmed: true, ...(current.launchDeadline !== undefined ? { launchDeadline: current.launchDeadline } : {}) };
  }

  if (session.status === "stopped") return interrupted(current, current.launchConfirmed === true);
  if (heartbeat?.state === "shutdown" && reported) return interrupted(current, true);
  if (presence === "missing" && current.launchConfirmed) return interrupted(current, true);
  if (presence === "missing" && current.launchDeadline !== undefined && now > current.launchDeadline) {
    return { ...current, phase: "error", error: "Fork launch was not confirmed" };
  }

  if (!reported) return current;
  const phase = current.phase === "compacting" || reported.phase === "compacting" ? "compacting" : "preparing";
  return {
    ...current,
    ...reported,
    phase,
    launchConfirmed: true,
    ...(current.launchDeadline !== undefined ? { launchDeadline: current.launchDeadline } : {}),
  };
}

function interrupted(current: ForkPreparation, launchConfirmed: boolean): ForkPreparation {
  return { ...current, phase: "error", launchConfirmed, error: "Fork preparation was interrupted" };
}

function isPhase(value: unknown): value is ForkPreparation["phase"] {
  return value === "preparing" || value === "compacting" || value === "ready" || value === "error";
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= max ? trimmed : undefined;
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
