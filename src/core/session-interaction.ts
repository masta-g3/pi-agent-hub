import { createConnection } from "node:net";
import { join } from "node:path";
import { sessionsStateDir } from "./paths.js";
import type { ConversationPage } from "./conversation.js";

export const INTERACTION_BYTE_CAP = 256 * 1024;
export const INTERACTION_TIMEOUT_MS = 5_000;
export const DELIVERY_UNCONFIRMED = "Delivery not confirmed; check Pi before retrying";
export interface InteractionTarget { managedId: string; piSessionId: string; instanceId: string }
export interface PendingQuestion {
  toolCallId: string;
  params: { questions: { question: string; header: string; options: { label: string; description: string; preview?: string }[]; multiSelect?: boolean }[] };
}
export type AnswerInput = { questionIndex: number; kind: "option"; optionIndex: number }
  | { questionIndex: number; kind: "custom"; text: string }
  | { questionIndex: number; kind: "multi"; optionIndices: number[] };
export interface SessionInteractionState { questionProtocol: boolean; pending: PendingQuestion[]; shortcutDisabledReason?: string }
export type InteractionRequest = InteractionTarget & { version: 1; id: string } & (
  { kind: "state" } | { kind: "read"; before?: string; branchId?: string; limit?: number }
  | { kind: "submit-answer"; toolCallId: string; answers: AnswerInput[] }
  | { kind: "run-shortcut"; key: string; expectedSend: string });
export type InteractionResult = SessionInteractionState | ConversationPage | { accepted: true };
export type InteractionResponse = InteractionTarget & { version: 1; id: string } & ({ ok: true; result: InteractionResult } | { ok: false; error: string });
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function interactionSocketPath(managedId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!identifier(managedId)) throw new Error("Invalid managed session identity");
  const path = join(sessionsStateDir(env), "interactions", `${managedId}.sock`);
  if (Buffer.byteLength(path) > 103 || process.platform === "win32") throw new Error("Interaction Unix socket path is unsupported or too long");
  return path;
}
export function sameInteractionTarget(a?: InteractionTarget, b?: InteractionTarget): boolean {
  return a?.managedId === b?.managedId && a?.piSessionId === b?.piSessionId && a?.instanceId === b?.instanceId;
}
export function parseInteractionRequest(value: unknown): InteractionRequest | undefined {
  if (!isObject(value) || value.version !== 1 || !identifier(value.id) || !identifier(value.managedId) || !identifier(value.piSessionId) || !identifier(value.instanceId)) return;
  const text = (v: unknown) => typeof v === "string";
  if (value.kind === "state"
    || value.kind === "read" && (value.before === undefined || text(value.before)) && (value.branchId === undefined || text(value.branchId)) && (value.limit === undefined || Number.isInteger(value.limit) && Number(value.limit) > 0 && Number(value.limit) <= 20)
    || value.kind === "run-shortcut" && text(value.key) && text(value.expectedSend)
    || value.kind === "submit-answer" && text(value.toolCallId) && Array.isArray(value.answers) && value.answers.length <= 4 && value.answers.every(isAnswerInput)) return value as unknown as InteractionRequest;
}
function isAnswerInput(value: unknown): boolean {
  if (!isObject(value) || !Number.isInteger(value.questionIndex) || Number(value.questionIndex) < 0 || Number(value.questionIndex) > 3) return false;
  return value.kind === "custom" && typeof value.text === "string" && Boolean(value.text.trim())
    || value.kind === "option" && Number.isInteger(value.optionIndex) && Number(value.optionIndex) >= 0
    || value.kind === "multi" && Array.isArray(value.optionIndices) && value.optionIndices.every((i) => Number.isInteger(i) && i >= 0);
}
export function parsePendingQuestions(value: unknown): PendingQuestion[] | undefined {
  if (!Array.isArray(value) || !value.every((p) => isObject(p) && typeof p.toolCallId === "string" && p.toolCallId.length > 0 && isObject(p.params)
    && Array.isArray(p.params.questions) && p.params.questions.length >= 1 && p.params.questions.length <= 4
    && p.params.questions.every((q: unknown) => isObject(q) && typeof q.question === "string" && typeof q.header === "string"
      && (q.multiSelect === undefined || typeof q.multiSelect === "boolean") && Array.isArray(q.options)
      && q.options.length >= 2 && q.options.length <= 4 && q.options.every((o: unknown) => isObject(o) && typeof o.label === "string" && typeof o.description === "string" && (o.preview === undefined || typeof o.preview === "string"))))) return;
  return value as PendingQuestion[];
}
export function requestSessionInteraction(request: InteractionRequest, env: NodeJS.ProcessEnv = process.env): Promise<InteractionResult> {
  const path = interactionSocketPath(request.managedId, env);
  const frame = JSON.stringify(request) + "\n";
  if (Buffer.byteLength(frame) > INTERACTION_BYTE_CAP) return Promise.reject(new Error("Interaction request too large"));
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = Buffer.alloc(0);
    let settled = false;
    const write = request.kind === "run-shortcut" || request.kind === "submit-answer";
    const finish = (error?: Error, result?: InteractionResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error(write ? DELIVERY_UNCONFIRMED : "Session interaction timed out")), INTERACTION_TIMEOUT_MS);
    socket.on("connect", () => socket.write(frame));
    socket.on("error", () => finish(new Error(write ? DELIVERY_UNCONFIRMED : "Session interaction unavailable")));
    socket.on("close", () => finish(new Error(write ? DELIVERY_UNCONFIRMED : "Session interaction closed")));
    socket.on("data", (chunk: Buffer) => {
      if (buffer.length + chunk.length > INTERACTION_BYTE_CAP) return finish(new Error("Interaction response too large"));
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      try {
        const response: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        if (!isObject(response) || response.version !== 1 || response.id !== request.id || !sameInteractionTarget(response as unknown as InteractionTarget, request)) throw new Error("Session interaction identity mismatch");
        if (response.ok === false && typeof response.error === "string") return finish(new Error(response.error.slice(0, 500)));
        if (response.ok !== true || !validResult(request.kind, response.result)) throw new Error("Invalid interaction response");
        finish(undefined, response.result as unknown as InteractionResult);
      } catch (error) { finish(error instanceof Error ? error : new Error("Invalid interaction response")); }
    });
  });
}

function validResult(kind: InteractionRequest["kind"], value: unknown): value is InteractionResult {
  if (!isObject(value)) return false;
  if (kind === "state") return typeof value.questionProtocol === "boolean" && parsePendingQuestions(value.pending) !== undefined
    && (value.shortcutDisabledReason === undefined || typeof value.shortcutDisabledReason === "string");
  if (kind === "read") return typeof value.branchId === "string" && typeof value.revision === "string"
    && (value.before === undefined || typeof value.before === "string") && Array.isArray(value.items) && value.items.length <= 20
    && value.items.every((item) => isObject(item) && typeof item.id === "string" && typeof item.text === "string"
      && ["user", "assistant", "question", "answer"].includes(String(item.role)) && (item.truncated === undefined || typeof item.truncated === "boolean")
      && (item.toolCallId === undefined || typeof item.toolCallId === "string"));
  return value.accepted === true;
}
