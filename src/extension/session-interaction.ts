import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { isErrno } from "../core/atomic-json.js";
import { effectiveDashboardShortcuts } from "../core/config.js";
import { conversationText, questionCallArguments, readConversation } from "../core/conversation.js";
import { OPTION_PREVIEW_BYTE_CAP, INTERACTION_BYTE_CAP, INTERACTION_TIMEOUT_MS, DELIVERY_UNCONFIRMED, interactionSocketPath, isObject, parseInteractionRequest, parsePendingQuestions, sameInteractionTarget, type InteractionRequest, type InteractionResponse, type InteractionResult, type InteractionTarget, type PendingQuestion, type SessionInteractionState } from "../core/session-interaction.js";

function boundedPreview(source: string, bytes: number): string | undefined {
  if (bytes < 2) return;
  const text = conversationText(source);
  if (Buffer.byteLength(JSON.stringify(text)) <= bytes) return text;
  let low = 0;
  let high = Math.min(text.length, bytes);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(0, mid))) <= bytes) low = mid;
    else high = mid - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/u.test(text[low - 1]!)) low--;
  return text.slice(0, low);
}

export interface InteractionAdapter {
  managedId: string; piSessionId: string; env?: NodeJS.ProcessEnv;
  events: { on(name: string, fn: (data: unknown) => void): () => void; emit(name: string, data: unknown): void };
  getPiSessionId(): string | undefined;
  getBranch(): readonly unknown[];
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  getEditorText(): string;
  uiPromptOpen(): boolean;
  sendUserMessage(text: string, options: { expandPromptTemplates: boolean; deliverAs?: "steer" | "followUp" }): void;
}
export async function startSessionInteraction(adapter: InteractionAdapter) {
  const target: InteractionTarget = { managedId: adapter.managedId, piSessionId: adapter.piSessionId, instanceId: randomUUID() };
  const path = interactionSocketPath(target.managedId, adapter.env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  try {
    const old = await lstat(path);
    if (!old.isSocket()) throw new Error("Interaction endpoint occupied by a non-socket");
    const stale = await new Promise<boolean>((resolve, reject) => {
      const probe = createConnection(path);
      const timer = setTimeout(() => { probe.destroy(); reject(new Error("Interaction endpoint occupied")); }, 250);
      probe.on("connect", () => { clearTimeout(timer); probe.destroy(); resolve(false); });
      probe.on("error", (error) => { clearTimeout(timer); probe.destroy(); if (isErrno(error, "ECONNREFUSED")) resolve(true); else reject(error); });
    });
    if (!stale) throw new Error("Interaction endpoint occupied");
    const current = await lstat(path);
    if (current.ino !== old.ino || current.dev !== old.dev) throw new Error("Interaction endpoint changed");
    await unlink(path);
  } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
  let active = true;
  let branchId: string = randomUUID();
  let dispatching = false;
  const questionnaires = new Map<string, PendingQuestion>();
  const unsupported = new Set<string>();
  let questionProtocol = false;
  let legacyProducer = false;
  const unsubscribe = [
    adapter.events.on("rpiv:ask-user:prompt", (data) => {
      if (!isObject(data)) return;
      if (data.toolCallId === undefined) { legacyProducer = true; return; }
      const pending = parsePendingQuestions([{ toolCallId: data.toolCallId, params: { questions: data.questions } }]);
      if (!pending || Buffer.byteLength(JSON.stringify(pending)) > INTERACTION_BYTE_CAP - 2048) return;
      for (const question of pending[0]!.params.questions) for (const option of question.options) delete option.preview;
      questionnaires.set(pending[0]!.toolCallId, pending[0]!);
      questionProtocol = true;
    }),
    adapter.events.on("rpiv:ask-user:blocked", (data) => {
      if (!isObject(data) || data.active !== false || typeof data.toolCallId !== "string") return;
      questionnaires.delete(data.toolCallId);
      unsupported.delete(data.toolCallId);
    }),
  ];
  const pendingQuestions = () => [...questionnaires.values()].filter(p => !unsupported.has(p.toolCallId));
  const unavailableReason = () => legacyProducer ? "Update rpiv-ask-user-question to 2.15+ to answer from Hub"
    : unsupported.size || adapter.uiPromptOpen() && !questionnaires.size ? "This prompt can only be answered in Pi" : undefined;
  const clients = new Set<Socket>();
  const cancellations = new Set<() => void>();
  const receipts = new Map<string, { fingerprint: string; promise: Promise<InteractionResponse>; complete: boolean }>();
  const check = () => { if (!active || adapter.getPiSessionId() !== target.piSessionId) throw new Error("Session interaction unavailable"); };
  function submitAnswer(toolCallId: string, answers: Extract<InteractionRequest, { kind: "submit-answer" }>["answers"]): Promise<Record<string, unknown> | undefined> {
    check();
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let finished = false;
      const finish = (value?: Record<string, unknown>, error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); off(); cancellations.delete(cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(undefined, new Error("Session interaction unavailable"));
      const timer = setTimeout(() => finish(), INTERACTION_TIMEOUT_MS);
      const off = adapter.events.on("rpiv:ask-user:answer-result", (data) => {
        if (isObject(data) && data.requestId === requestId && typeof data.ok === "boolean") finish(data);
      });
      cancellations.add(cancel);
      try {
        check();
        adapter.events.emit("rpiv:ask-user:answer", { toolCallId, requestId, answers: answers.map(answer => answer.kind === "custom"
          ? { questionIndex: answer.questionIndex, text: answer.text }
          : { questionIndex: answer.questionIndex, optionIndexes: answer.kind === "option" ? [answer.optionIndex] : answer.optionIndices }) });
      } catch { finish(undefined, new Error("Session interaction unavailable")); }
    });
  }
  function disabled(pending: PendingQuestion[]): string | undefined {
    check();
    if (dispatching) return "Command dispatch in progress";
    if (!adapter.isIdle()) return "Pi is busy";
    if (adapter.hasPendingMessages()) return "Pi has queued messages";
    if (adapter.uiPromptOpen() || pending.length || unsupported.size) return "Answer the pending Pi question first";
    if (adapter.getEditorText().trim()) return "Clear the Pi editor draft first";
  }
  async function handle(request: InteractionRequest): Promise<InteractionResult> {
    const generation = branchId;
    const checkRequest = () => { check(); if (generation !== branchId) throw new Error("Conversation branch changed"); };
    checkRequest();
    if (request.kind === "read") {
      if (request.branchId !== undefined && request.branchId !== branchId) throw new Error("Conversation branch changed");
      const branch = [...adapter.getBranch()];
      checkRequest();
      return readConversation(branch, { branchId: generation, before: request.before, limit: request.limit });
    }
    if (request.kind === "state") {
      const pending = structuredClone(pendingQuestions());
      const state: SessionInteractionState = { questionProtocol, pending, questionUnavailableReason: unavailableReason(), shortcutDisabledReason: disabled(pending), messageDelivery: adapter.isIdle() ? "idle" : "busy" };
      // Include the full response envelope, including the caller's ID, in the preview budget.
      let budget = INTERACTION_BYTE_CAP - Buffer.byteLength(JSON.stringify({ version: 1, id: request.id, ...target, ok: true, result: state })) - 1;
      const branch = adapter.getBranch();
      checkRequest();
      for (const request of pending) {
        const args = questionCallArguments(branch, request.toolCallId);
        const sources = args?.questions;
        if (!Array.isArray(sources)) continue;
        request.params.questions.forEach((question, qi) => {
          const source = sources[qi];
          if (!isObject(source) || source.question !== question.question || !Array.isArray(source.options)) return;
          const options = source.options;
          question.options.forEach((option, oi) => {
            const original = options[oi];
            if (!isObject(original) || original.label !== option.label || typeof original.preview !== "string") return;
            const preview = boundedPreview(original.preview, Math.min(OPTION_PREVIEW_BYTE_CAP, budget - 11));
            if (preview === undefined) return;
            option.preview = preview;
            budget -= Buffer.byteLength(JSON.stringify(preview)) + 11;
          });
        });
      }
      return state;
    }
    if (request.kind === "submit-answer") {
      if (unsupported.has(request.toolCallId)) throw new Error("This prompt can only be answered in Pi");
      if (!questionnaires.has(request.toolCallId)) throw new Error("Question stale; answered elsewhere or closed");
      let reply: Record<string, unknown> | undefined;
      try { reply = await submitAnswer(request.toolCallId, request.answers); }
      finally { checkRequest(); }
      if (!reply) throw new Error(DELIVERY_UNCONFIRMED);
      if (reply.ok === true) { questionnaires.delete(request.toolCallId); return { accepted: true }; }
      if (reply.code === "not_found") {
        questionnaires.delete(request.toolCallId);
        throw new Error("Question stale; answered elsewhere or closed");
      }
      if (reply.code === "unsupported_host") {
        unsupported.add(request.toolCallId);
        throw new Error("This prompt can only be answered in Pi");
      }
      throw new Error(`Answer rejected: ${typeof reply.reason === "string" ? reply.reason : String(reply.code)}`);
    }
    if (request.kind === "send-message") {
      if (request.delivery === "send" && !adapter.isIdle()) throw new Error("Pi started working; choose Steer now or Queue for later");
      checkRequest();
      adapter.sendUserMessage(request.text, {
        deliverAs: request.delivery === "followUp" ? "followUp" : "steer",
        // Busy messages are text: slash commands must not bypass the chosen queue.
        expandPromptTemplates: request.delivery === "send",
      });
      return { accepted: true };
    }
    const shortcuts = await effectiveDashboardShortcuts(adapter.env);
    const shortcut = shortcuts.find((s) => s.key === request.key);
    if (!shortcut || shortcut.send !== request.expectedSend) throw new Error("Configured command changed or unavailable");
    const pending = pendingQuestions();
    checkRequest();
    const reason = disabled(pending);
    if (reason) throw new Error(reason);
    dispatching = true;
    try { check(); adapter.sendUserMessage(shortcut.send, { expandPromptTemplates: true }); }
    catch { dispatching = false; throw new Error("Pi command dispatch unavailable"); }
    return { accepted: true };
  }
  const server = createServer((socket) => {
    clients.add(socket);
    const timer = setTimeout(() => socket.destroy(), INTERACTION_TIMEOUT_MS);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => { clearTimeout(timer); clients.delete(socket); });
    let buffer = Buffer.alloc(0);
    let received = false;
    socket.on("data", (chunk: Buffer) => {
      if (received) return;
      if (buffer.length + chunk.length > INTERACTION_BYTE_CAP) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      received = true;
      let request: InteractionRequest | undefined;
      try { request = parseInteractionRequest(JSON.parse(buffer.subarray(0, newline).toString("utf8"))); } catch {}
      buffer = Buffer.alloc(0);
      if (!request) { socket.destroy(); return; }
      const identity = { version: 1 as const, id: request.id, ...target };
      const failure = (error: string): InteractionResponse => ({ ...identity, ok: false, error });
      const send = (response: InteractionResponse) => {
        if (socket.destroyed) return;
        let frame = JSON.stringify(response) + "\n";
        if (Buffer.byteLength(frame) > INTERACTION_BYTE_CAP) frame = JSON.stringify(failure("Interaction response too large")) + "\n";
        socket.end(frame);
      };
      if (!sameInteractionTarget(request, target)) {
        send({ version: 1, id: request.id, managedId: request.managedId, piSessionId: request.piSessionId, instanceId: request.instanceId, ok: false, error: "Session interaction unavailable" });
        return;
      }
      const write = request.kind === "run-shortcut" || request.kind === "submit-answer" || request.kind === "send-message";
      const fingerprint = JSON.stringify(request);
      const existing = receipts.get(request.id);
      if (existing) { if (existing.fingerprint !== fingerprint) send(failure("Request ID already used")); else void existing.promise.then(send); return; }
      if (write && receipts.size >= 128) {
        const oldest = [...receipts].find(([, receipt]) => receipt.complete);
        if (!oldest) { send(failure("Session interaction busy")); return; }
        receipts.delete(oldest[0]);
      }
      // Schedule after recording the receipt, including re-entrant duplicate requests.
      const promise: Promise<InteractionResponse> = Promise.resolve().then(() => handle(request!)).then(
        (result) => ({ ...identity, ok: true as const, result }),
        (error: unknown) => failure(error instanceof Error && !error.message.includes("stale after session replacement or reload")
          ? error.message.slice(0, 500) : "Session interaction unavailable"),
      );
      if (write) {
        const receipt = { fingerprint, promise, complete: false };
        receipts.set(request.id, receipt);
        void promise.then(() => { receipt.complete = true; });
      }
      void promise.then(send);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => { server.off("error", reject); resolve(); }); });
  } catch (error) { for (const off of unsubscribe) off(); throw error; }
  let owned;
  try {
    await chmod(path, 0o600);
    owned = await lstat(path);
  } catch (error) {
    active = false;
    for (const off of unsubscribe) off();
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    target,
    branchChanged() { branchId = randomUUID(); questionnaires.clear(); unsupported.clear(); for (const cancel of cancellations) cancel(); },
    lifecycleChanged() { dispatching = false; },
    async close() {
      if (!active) return;
      active = false;
      for (const off of unsubscribe) off();
      for (const cancel of cancellations) cancel();
      for (const client of clients) client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try { const current = await lstat(path); if (current.ino === owned.ino && current.dev === owned.dev) await unlink(path); }
      catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
      receipts.clear();
    },
  };
}
