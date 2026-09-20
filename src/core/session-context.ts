import { isAbsolute } from "node:path";
import type { PiAgentHubContextV1, SessionAttention, WorktreeLifecycleRepository, WorktreeLifecycleSnapshot } from "./types.js";

const TICKET_ID_MAX = 80;
const SUBTITLE_MAX = 64;
const DESCRIPTION_MAX = 240;
const ATTENTION_MAX = 150;
const ATTENTION_REQUEST_ID_MAX = 64;
const WORKTREE_ID_MAX = 128;
const WORKTREE_PRODUCER_MAX = 80;
const WORKTREE_PATH_MAX = 1024;
const WORKTREE_BRANCH_MAX = 240;
const WORKTREE_ISSUE_MAX = 240;
const WORKTREE_REPOSITORY_MAX = 16;

export function parseSessionContext(value: unknown): PiAgentHubContextV1 | undefined {
  if (!isObject(value) || value.version !== 1 || !finiteNumber(value.updatedAt)) return undefined;
  const ticket = parseTicket(value.ticket);
  if (value.ticket !== undefined && !ticket) return undefined;
  const attention = parseAttention(value.attention);
  if (value.attention !== undefined && !attention) return undefined;
  // Optional producer decorations are isolated: malformed lifecycle data must
  // not hide otherwise valid ticket, attention, or liveness metadata.
  const worktree = parseWorktreeLifecycle(value.worktree);
  return {
    version: 1,
    updatedAt: value.updatedAt,
    ...(ticket ? { ticket } : {}),
    ...(attention ? { attention } : {}),
    ...(worktree ? { worktree } : {}),
  };
}

export function parseWorktreeLifecycle(value: unknown): WorktreeLifecycleSnapshot | undefined {
  if (!isObject(value) || value.version !== 1) return undefined;
  const recordId = boundedText(value.recordId, WORKTREE_ID_MAX);
  const producer = boundedText(value.producer, WORKTREE_PRODUCER_MAX);
  if (!recordId || !producer || !nonnegativeInteger(value.revision) || !finiteNumber(value.updatedAt) || value.updatedAt < 0) return undefined;
  if (value.cleared === true) {
    if (value.repositories !== undefined) return undefined;
    return { version: 1, recordId, producer, revision: value.revision, updatedAt: value.updatedAt, cleared: true };
  }
  if (!Array.isArray(value.repositories) || value.repositories.length < 1 || value.repositories.length > WORKTREE_REPOSITORY_MAX) return undefined;
  const repositories = value.repositories.map(parseWorktreeRepository);
  if (repositories.some((item) => !item)) return undefined;
  const paths = new Set(repositories.map((item) => item!.worktreePath));
  if (paths.size !== repositories.length || repositories.filter((item) => item!.role === "primary").length !== 1) return undefined;
  return { version: 1, recordId, producer, revision: value.revision, updatedAt: value.updatedAt, repositories: repositories as WorktreeLifecycleRepository[] };
}

function parseWorktreeRepository(value: unknown): WorktreeLifecycleRepository | undefined {
  if (!isObject(value)) return undefined;
  const sourcePath = boundedRawText(value.sourcePath, WORKTREE_PATH_MAX);
  const worktreePath = boundedRawText(value.worktreePath, WORKTREE_PATH_MAX);
  const branch = boundedRawText(value.branch, WORKTREE_BRANCH_MAX);
  if (!sourcePath || !worktreePath || !isAbsolute(sourcePath) || !isAbsolute(worktreePath) || !branch || (value.role !== "primary" && value.role !== "additional")
    || !["active", "awaiting-merge", "cleanup-pending", "check-needed", "cleaned"].includes(String(value.state))) return undefined;
  if (value.outcome !== undefined && value.outcome !== "merged" && value.outcome !== "discarded") return undefined;
  if (value.verifiedAt !== undefined && (!finiteNumber(value.verifiedAt) || value.verifiedAt < 0)) return undefined;
  const issue = optionalText(value.issue, WORKTREE_ISSUE_MAX);
  if (issue === null || (value.branchDeleted !== undefined && typeof value.branchDeleted !== "boolean")) return undefined;
  return {
    sourcePath, worktreePath, branch, role: value.role, state: value.state as WorktreeLifecycleRepository["state"],
    ...(value.outcome ? { outcome: value.outcome as WorktreeLifecycleRepository["outcome"] } : {}),
    ...(typeof value.verifiedAt === "number" ? { verifiedAt: value.verifiedAt } : {}),
    ...(issue ? { issue } : {}),
    ...(typeof value.branchDeleted === "boolean" ? { branchDeleted: value.branchDeleted } : {}),
  };
}

function parseTicket(value: unknown): PiAgentHubContextV1["ticket"] | undefined {
  if (!isObject(value)) return undefined;
  const id = boundedText(value.id, TICKET_ID_MAX);
  if (!id) return undefined;
  const subtitle = optionalText(value.subtitle, SUBTITLE_MAX);
  const description = optionalText(value.description, DESCRIPTION_MAX);
  if (subtitle === null || description === null) return undefined;
  return { id, ...(subtitle ? { subtitle } : {}), ...(description ? { description } : {}) };
}

function parseAttention(value: unknown): SessionAttention | undefined {
  if (!isObject(value) || !["ready", "question", "blocked"].includes(String(value.kind))) return undefined;
  const requestId = optionalText(value.requestId, ATTENTION_REQUEST_ID_MAX);
  const text = boundedText(value.text, ATTENTION_MAX);
  if (requestId === null || !text) return undefined;
  return { ...(requestId ? { requestId } : {}), kind: value.kind as SessionAttention["kind"], text };
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return boundedText(value, max) || null;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text && [...text].length <= max ? text : undefined;
}

function boundedRawText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && [...text].length <= max && !/[\r\n\0]/u.test(text) ? text : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
