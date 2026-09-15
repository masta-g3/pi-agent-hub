import { randomUUID } from "node:crypto";
import type { RuntimeSession } from "../core/types.js";
import type { ConversationPage } from "../core/conversation.js";
import { requestSessionInteraction, type AnswerInput, type InteractionRequest, type InteractionTarget, type SessionInteractionState } from "../core/session-interaction.js";
export type { AnswerInput, InteractionTarget, PendingQuestion, SessionInteractionState } from "../core/session-interaction.js";

export function interactionTarget(session: RuntimeSession): InteractionTarget | undefined {
  if (session.kind === "subagent" || !session.piSessionId || !session.interaction || session.status === "stopped" || session.status === "error" || session.forkPreparation && session.forkPreparation.phase !== "ready") return;
  return { managedId: session.id, piSessionId: session.piSessionId, instanceId: session.interaction.instanceId };
}
const envelope = (target: InteractionTarget) => ({ ...target, version: 1 as const, id: randomUUID() });
export async function loadSessionInteractionState(target: InteractionTarget): Promise<SessionInteractionState> {
  return await requestSessionInteraction({ ...envelope(target), kind: "state" }) as SessionInteractionState;
}
export async function loadSessionConversation(target: InteractionTarget, options: { before?: string; branchId?: string; limit?: number } = {}): Promise<ConversationPage> {
  return await requestSessionInteraction({ ...envelope(target), kind: "read", ...options }) as ConversationPage;
}
export async function submitSessionAnswer(target: InteractionTarget, toolCallId: string, answers: AnswerInput[]): Promise<void> {
  await requestSessionInteraction({ ...envelope(target), kind: "submit-answer", toolCallId, answers });
}
export async function runSessionShortcut(target: InteractionTarget, key: string, expectedSend: string): Promise<void> {
  const request: InteractionRequest = { ...envelope(target), kind: "run-shortcut", key, expectedSend };
  await requestSessionInteraction(request);
}
