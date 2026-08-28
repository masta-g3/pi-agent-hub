import type { RuntimeStatusEvidence } from "../core/types.js";
import { ageLabel } from "./age.js";
import type { CockpitPlacementReason, CockpitTier, RenderSession } from "./render-model.js";

export type StatusEvidenceField =
  | { kind: "fact"; label: "tmux" | "heartbeat" | "read" | "workflow"; marker: "✓" | "×" | "·"; tone: "success" | "error" | "dim"; value: string }
  | { kind: "result"; label: "result"; marker: "→"; status: RenderSession["displayStatus"]; tier: CockpitTier; reason: string };

export function statusEvidenceFields(session: RenderSession, now: number): StatusEvidenceField[] {
  const evidence = session.statusEvidence;
  const fields: StatusEvidenceField[] = [];
  if (!evidence) {
    fields.push({ kind: "fact", label: "tmux", marker: "·", tone: "dim", value: "live evidence unavailable" });
  } else {
    fields.push(tmuxField(evidence.tmux));
    fields.push(heartbeatField(evidence.heartbeat, now));
    fields.push(readField(evidence.acknowledgement.state));
  }
  const placement = placementReason(session.cockpitPlacement, session.id);
  const runtime = evidence ? runtimeReason(evidence) : undefined;
  fields.push({
    kind: "result",
    label: "result",
    marker: "→",
    status: session.displayStatus,
    tier: session.cockpitTier,
    reason: runtime ? `${runtime}; ${placement}` : placement,
  });
  fields.push(workflowField(evidence?.workflow));
  return fields;
}

function tmuxField(tmux: NonNullable<RenderSession["statusEvidence"]>["tmux"]): StatusEvidenceField {
  if (tmux.state === "present") return { kind: "fact", label: "tmux", marker: "✓", tone: "success", value: "tmux session present" };
  if (tmux.state === "unknown") {
    return { kind: "fact", label: "tmux", marker: "×", tone: "error", value: `tmux did not answer${tmux.error ? ` · ${tmux.error}` : ""}` };
  }
  return { kind: "fact", label: "tmux", marker: "×", tone: "error", value: "tmux session missing" };
}

function heartbeatField(heartbeat: NonNullable<RenderSession["statusEvidence"]>["heartbeat"], now: number): StatusEvidenceField {
  if (heartbeat.freshness === "missing") {
    return { kind: "fact", label: "heartbeat", marker: "×", tone: "error", value: "no heartbeat · using tmux fallback" };
  }
  const age = heartbeat.updatedAt === undefined ? "unknown age" : `${ageLabel(Math.max(0, now - heartbeat.updatedAt))} old`;
  const state = heartbeat.state ? ` · Pi state ${heartbeat.state}` : "";
  const message = heartbeat.message ? ` · ${heartbeat.message}` : "";
  if (heartbeat.freshness === "stale") {
    return { kind: "fact", label: "heartbeat", marker: "×", tone: "error", value: `heartbeat stale · ${age}${state}${message}` };
  }
  return { kind: "fact", label: "heartbeat", marker: "✓", tone: "success", value: `heartbeat fresh · ${age}${state}${message}` };
}

function readField(state: NonNullable<RenderSession["statusEvidence"]>["acknowledgement"]["state"]): StatusEvidenceField {
  if (state === "unread") return { kind: "fact", label: "read", marker: "✓", tone: "success", value: "agent result is newer than your last read" };
  if (state === "read") return { kind: "fact", label: "read", marker: "✓", tone: "success", value: "latest agent result was read" };
  return { kind: "fact", label: "read", marker: "·", tone: "dim", value: "read state does not affect this result" };
}

function workflowField(workflow: RuntimeStatusEvidence["workflow"] | undefined): StatusEvidenceField {
  if (!workflow || workflow.source === "absent") {
    return { kind: "fact", label: "workflow", marker: "·", tone: "dim", value: "no workflow reported" };
  }
  const position = workflow.activeIndex !== undefined && workflow.stepCount !== undefined
    ? `producer step ${workflow.activeIndex + 1}/${workflow.stepCount}`
    : "producer workflow";
  const label = workflow.stepLabel ? ` · ${workflow.stepLabel}` : "";
  const source = workflow.source === "fresh" ? " · fresh" : " · retained from last fresh heartbeat";
  return { kind: "fact", label: "workflow", marker: "·", tone: "dim", value: `${position}${label}${source}` };
}

function runtimeReason(evidence: RuntimeStatusEvidence): string {
  switch (evidence.reason) {
    case "tmux-stopped": return "registered session is stopped and tmux is absent";
    case "tmux-missing": return "tmux session is missing";
    case "tmux-unknown": return "tmux observation failed";
    case "heartbeat-error": return "Pi heartbeat reported an error";
    case "heartbeat-shutdown": return "Pi heartbeat reported shutdown";
    case "heartbeat-active": return `fresh heartbeat reports ${evidence.heartbeat.state === "starting" ? "starting" : "running"}`;
    case "fallback-active": return "heartbeat unavailable; recent tmux activity indicates running";
    case "fallback-starting": return "heartbeat unavailable; previous starting state retained";
    case "fallback-waiting": return evidence.acknowledgement.state === "unread"
      ? "heartbeat unavailable; unread result remains waiting"
      : "heartbeat unavailable; previous running state became waiting";
    case "fallback-idle": return "heartbeat unavailable; latest result was already read";
    case "heartbeat-unread": return "fresh heartbeat reports an unread result";
    case "heartbeat-read": return "fresh heartbeat result was already read";
  }
}

function placementReason(placement: CockpitPlacementReason, selectedId: string): string {
  const owner = placement.ownerId === selectedId ? "" : ` with owner ${JSON.stringify(placement.ownerTitle)}`;
  switch (placement.kind) {
    case "archived": return `lifecycle archived${owner}`;
    case "explicit-attention": return `${attentionReason(placement.attentionKind)}${owner}`;
    case "owner-error": return `owner reported an error${owner}`;
    case "owner-active": return `owner is ${placement.status}${owner}`;
    case "descendant-active": return `${placement.driverTitle} is ${placement.status}${owner}`;
    case "quiet": return `no explicit request, error, or active work${owner}`;
  }
}

function attentionReason(kind: "ready" | "question" | "blocked"): string {
  if (kind === "ready") return "producer marked work ready";
  if (kind === "question") return "producer asked a question";
  return "producer reported a blocker";
}
