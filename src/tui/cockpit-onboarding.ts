export const COCKPIT_RELEASE_CUE = {
  id: "cockpit-daily-loop-v1",
  label: "NEW DAILY LOOP",
  text: "NEEDS YOU is explicit · Enter reaches · Alt+Q returns",
} as const;

export type CockpitOnboardingState =
  | { cohort: "new"; phase: "learning" }
  | { cohort: "new"; phase: "awaiting-return"; sessionId: string; requestId: string }
  | { cohort: "new"; phase: "complete" };

export function normalizeCockpitOnboarding(value: unknown): CockpitOnboardingState | undefined {
  if (!isRecord(value) || value.cohort !== "new") return undefined;
  if (value.phase === "learning" || value.phase === "complete") return { cohort: "new", phase: value.phase };
  if (value.phase !== "awaiting-return" || !boundedId(value.sessionId) || !boundedId(value.requestId)) return undefined;
  return { cohort: "new", phase: "awaiting-return", sessionId: value.sessionId, requestId: value.requestId };
}

export function startAttentionTrip(
  state: CockpitOnboardingState | undefined,
  request: { sessionId: string; requestId: string },
): CockpitOnboardingState | undefined {
  if (state?.phase !== "learning" || !boundedId(request.sessionId) || !boundedId(request.requestId)) return state;
  return { cohort: "new", phase: "awaiting-return", ...request };
}

export function completeAttentionTrip(state: CockpitOnboardingState | undefined): CockpitOnboardingState | undefined {
  return state?.phase === "awaiting-return" ? { cohort: "new", phase: "complete" } : state;
}

export function coachingActive(state: CockpitOnboardingState | undefined): boolean {
  return state?.phase === "learning" || state?.phase === "awaiting-return";
}

export function releaseCueVisible(state: CockpitOnboardingState | undefined, dismissedCueId: string | undefined): boolean {
  return state === undefined && dismissedCueId !== COCKPIT_RELEASE_CUE.id;
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
