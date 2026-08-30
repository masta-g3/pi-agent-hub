import type { PiAgentHubContextV1, SessionAttention } from "./types.js";

const TICKET_ID_MAX = 80;
const SUBTITLE_MAX = 64;
const DESCRIPTION_MAX = 240;
const ATTENTION_MAX = 96;
const ATTENTION_REQUEST_ID_MAX = 64;

export function parseSessionContext(value: unknown): PiAgentHubContextV1 | undefined {
  if (!isObject(value) || value.version !== 1 || !finiteNumber(value.updatedAt)) return undefined;
  const ticket = parseTicket(value.ticket);
  if (value.ticket !== undefined && !ticket) return undefined;
  const attention = parseAttention(value.attention);
  if (value.attention !== undefined && !attention) return undefined;
  return {
    version: 1,
    updatedAt: value.updatedAt,
    ...(ticket ? { ticket } : {}),
    ...(attention ? { attention } : {}),
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

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
