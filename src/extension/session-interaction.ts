import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { isErrno } from "../core/atomic-json.js";
import { effectiveDashboardShortcuts } from "../core/config.js";
import { readConversation } from "../core/conversation.js";
import { INTERACTION_BYTE_CAP, INTERACTION_TIMEOUT_MS, DELIVERY_UNCONFIRMED, interactionSocketPath, isObject, parseInteractionRequest, parsePendingQuestions, sameInteractionTarget, type InteractionRequest, type InteractionResponse, type InteractionResult, type InteractionTarget, type PendingQuestion, type SessionInteractionState } from "../core/session-interaction.js";

export interface InteractionAdapter {
  managedId: string; piSessionId: string; env?: NodeJS.ProcessEnv;
  events: { on(name: string, fn: (data: unknown) => void): () => void; emit(name: string, data: unknown): void };
  getPiSessionId(): string | undefined;
  getBranch(): readonly unknown[];
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  getEditorText(): string;
  uiPromptOpen(): boolean;
  sendUserMessage(text: string, options: { expandPromptTemplates: true }): void;
}
const REQUEST_EVENT = "rpiv:ask-user:request";
const RESPONSE_EVENT = "rpiv:ask-user:response";

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
  let supported: boolean | undefined;
  let discovery: Promise<PendingQuestion[]> | undefined;
  const clients = new Set<Socket>();
  const cancellations = new Set<() => void>();
  const receipts = new Map<string, { fingerprint: string; promise: Promise<InteractionResponse>; complete: boolean }>();
  const check = () => { if (!active || adapter.getPiSessionId() !== target.piSessionId) throw new Error("Session interaction unavailable"); };
  function producer(body: Record<string, unknown>, timeout: number): Promise<unknown> {
    check();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      let finished = false;
      const finish = (value?: unknown, error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); off(); cancellations.delete(cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(undefined, new Error("Session interaction unavailable"));
      const timer = setTimeout(() => finish(), timeout);
      const off = adapter.events.on(RESPONSE_EVENT, (data) => {
        if (isObject(data) && data.version === 1 && data.id === id) finish(data);
      });
      cancellations.add(cancel);
      try { check(); adapter.events.emit(REQUEST_EVENT, { version: 1, id, ...body }); }
      catch { finish(undefined, new Error("Session interaction unavailable")); }
    });
  }
  async function query(): Promise<PendingQuestion[]> {
    if (supported === false) return [];
    if (discovery) return discovery;
    const work = (async () => {
      const reply = await producer({ kind: "query" }, 250);
      check();
      if (reply === undefined && supported === undefined) { supported = false; return []; }
      const pending = isObject(reply) && reply.ok === true ? parsePendingQuestions(reply.pending) : undefined;
      if (!pending || Buffer.byteLength(JSON.stringify(pending)) > INTERACTION_BYTE_CAP - 2048) throw new Error("Question state unavailable");
      supported = true;
      return pending;
    })();
    discovery = work;
    try { return await work; } finally { if (discovery === work) discovery = undefined; }
  }
  function disabled(pending: PendingQuestion[]): string | undefined {
    check();
    if (dispatching) return "Command dispatch in progress";
    if (!adapter.isIdle()) return "Pi is busy";
    if (adapter.hasPendingMessages()) return "Pi has queued messages";
    if (adapter.uiPromptOpen() || pending.length) return "Answer the pending Pi question first";
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
      const pending = await query();
      checkRequest();
      return { questionProtocol: supported === true, pending, shortcutDisabledReason: disabled(pending) } satisfies SessionInteractionState;
    }
    if (request.kind === "submit-answer") {
      const pending = await query();
      checkRequest();
      if (!supported) throw new Error("Direct answering unsupported");
      if (!pending.some((p) => p.toolCallId === request.toolCallId)) throw new Error("Question stale; answered elsewhere or closed");
      const reply = await producer({ kind: "submit", toolCallId: request.toolCallId, answers: request.answers }, 5_000);
      checkRequest();
      if (!reply) throw new Error(DELIVERY_UNCONFIRMED);
      if (!isObject(reply) || reply.ok !== true || reply.accepted !== true) throw new Error(isObject(reply) && typeof reply.error === "string" ? reply.error : "Answer unavailable");
      return { accepted: true };
    }
    const shortcuts = await effectiveDashboardShortcuts(adapter.env);
    const shortcut = shortcuts.find((s) => s.key === request.key);
    if (!shortcut || shortcut.send !== request.expectedSend) throw new Error("Configured command changed or unavailable");
    const pending = await query();
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
      const write = request.kind === "run-shortcut" || request.kind === "submit-answer";
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
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => { server.off("error", reject); resolve(); }); });
  let owned;
  try {
    await chmod(path, 0o600);
    owned = await lstat(path);
  } catch (error) {
    active = false;
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    target,
    branchChanged() { branchId = randomUUID(); for (const cancel of cancellations) cancel(); },
    lifecycleChanged() { dispatching = false; },
    async close() {
      if (!active) return;
      active = false;
      for (const cancel of cancellations) cancel();
      for (const client of clients) client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try { const current = await lstat(path); if (current.ino === owned.ino && current.dev === owned.dev) await unlink(path); }
      catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
      receipts.clear();
    },
  };
}
