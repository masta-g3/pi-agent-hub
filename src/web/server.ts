import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { interactionTarget } from "../app/session-interaction.js";
import type { ConversationPage } from "../core/conversation.js";
import { DELIVERY_UNCONFIRMED, isObject, parseInteractionRequest, sameInteractionTarget, type AnswerInput, type InteractionTarget, type MessageDelivery, type SessionInteractionState } from "../core/session-interaction.js";
import type { RuntimeSession } from "../core/types.js";
import { formatQuestionText } from "../tui/question-dialog.js";
import { visibleAttention } from "../tui/render-model.js";
import { buildInboxSnapshot, type InboxSession } from "./inbox.js";

export const WEB_BODY_CAP = 64 * 1024;
export const WEB_PING_MS = 4_000;

export interface PushSubscriptionInput { endpoint: string; p256dh: string; auth: string }

export interface WebServerDeps {
  staticDir: string;
  sessions(): RuntimeSession[];
  now?: () => number;
  loadState(target: InteractionTarget): Promise<SessionInteractionState>;
  loadConversation(target: InteractionTarget): Promise<ConversationPage>;
  submitAnswer(target: InteractionTarget, toolCallId: string, answers: AnswerInput[]): Promise<void>;
  sendMessage(target: InteractionTarget, text: string, delivery: MessageDelivery): Promise<void>;
  acknowledge(sessionId: string, requestId: string | undefined, dismiss: boolean, expected: { piSessionId?: string }): Promise<void>;
  touch(sessionId: string): Promise<void>;
  push?: {
    publicKey(): Promise<string>;
    subscribe(subscription: PushSubscriptionInput): Promise<void>;
    unsubscribe(endpoint: string): Promise<void>;
  };
}

export interface WebServer {
  server: Server;
  /** Send the current inbox to connected pages when it changed. */
  publish(): void;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/sw.js": { file: "sw.js", type: "text/javascript; charset=utf-8" },
  "/manifest.webmanifest": { file: "manifest.webmanifest", type: "application/manifest+json" },
  "/icon-192.png": { file: "icon-192.png", type: "image/png" },
  "/icon-512.png": { file: "icon-512.png", type: "image/png" },
};

export function webAssetsDir(importMetaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(importMetaUrl));
  // Compiled to dist/src/web; the page ships uncompiled at the package root.
  return resolve(here, "..", "..", "..", "web");
}

/** The origin a browser must report for this Host, or undefined when the Host is not ours (DNS rebinding). */
export function expectedOrigin(host: string | undefined): string | undefined {
  const match = /^(\[::1\]|[a-z0-9.-]+)(:\d{1,5})?$/iu.exec(host ?? "");
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return `http://${name}${match[2] ?? ""}`;
  // `tailscale serve` terminates HTTPS and forwards Host and Origin unchanged.
  return name.endsWith(".ts.net") ? `https://${name}${match[2] ?? ""}` : undefined;
}

export function createWebServer(deps: WebServerDeps): WebServer {
  const now = deps.now ?? Date.now;
  const streams = new Set<ServerResponse>();
  let published: string | undefined;

  const snapshotFrame = () => {
    const snapshot = buildInboxSnapshot(deps.sessions(), now());
    // Compare without the clock so an unchanged fleet sends nothing.
    return { key: JSON.stringify({ ...snapshot, now: 0 }), frame: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n` };
  };
  const ping = setInterval(() => { for (const stream of streams) stream.write("event: ping\ndata: {}\n\n"); }, WEB_PING_MS);
  ping.unref();

  const findSession = (id: string): RuntimeSession => {
    const session = deps.sessions().find((row) => row.id === id && row.kind !== "subagent");
    if (!session) throw new HttpError(404, "Session not found");
    return session;
  };
  const inboxRow = (id: string): InboxSession | undefined =>
    buildInboxSnapshot(deps.sessions(), now()).tiers.flatMap((tier) => tier.sessions).find((row) => row.id === id);

  /** The live target, only when it is the one the page displayed. */
  const boundTarget = (session: RuntimeSession, body: Record<string, unknown>): InteractionTarget => {
    const target = interactionTarget(session);
    const shown = { managedId: session.id, piSessionId: String(body.piSessionId ?? ""), instanceId: String(body.instanceId ?? "") };
    if (!target || !sameInteractionTarget(target, shown)) throw new HttpError(409, "Session changed; reload the page");
    return target;
  };

  const write = async (res: ServerResponse, send: () => Promise<void>, after: () => Promise<void>) => {
    try {
      await send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unknown = message === DELIVERY_UNCONFIRMED || /timeout|timed out/iu.test(message);
      return json(res, unknown ? 504 : 409, { status: unknown ? "unknown" : "rejected", error: message });
    }
    // Bookkeeping cannot turn confirmed delivery into a rejection.
    try { await after(); } catch { /* the next refresh shows the true state */ }
    json(res, 200, { status: "accepted" });
  };

  const routes = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = expectedOrigin(req.headers.host);
    if (!origin) throw new HttpError(403, "Host not allowed");
    const url = new URL(req.url ?? "/", origin);
    const path = url.pathname;
    const sessionRoute = /^\/api\/sessions\/([a-zA-Z0-9_-]{1,128})(?:\/(answer|reply|read))?$/u.exec(path);

    if (req.method === "GET") {
      const asset = STATIC_FILES[path];
      if (asset) {
        res.writeHead(200, { ...baseHeaders, "Content-Type": asset.type, "Cache-Control": "no-cache" });
        res.end(await readFile(join(deps.staticDir, asset.file)));
        return;
      }
      if (path === "/api/events") {
        res.writeHead(200, { ...baseHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
        const { key, frame } = snapshotFrame();
        res.write(frame);
        // Other pages may still be waiting for this state; only the first page owns the change marker.
        if (!streams.size) published = key;
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (path === "/api/push/key" && deps.push) return json(res, 200, { key: await deps.push.publicKey() });
      if (sessionRoute && !sessionRoute[2]) {
        const session = findSession(sessionRoute[1]!);
        return json(res, 200, await detail(session, url.searchParams.get("conversation") !== "0"));
      }
      throw new HttpError(404, "Not found");
    }

    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    if (req.headers.origin !== origin) throw new HttpError(403, "Origin not allowed");
    if (!/^application\/json\b/iu.test(req.headers["content-type"] ?? "")) throw new HttpError(403, "JSON body required");
    const body = await readBody(req);

    if (path === "/api/push/subscribe" && deps.push) {
      const keys = isObject(body.keys) ? body.keys : {};
      if (typeof body.endpoint !== "string" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") throw new HttpError(400, "Invalid subscription");
      try { await deps.push.subscribe({ endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth }); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid subscription"); }
      return json(res, 200, { ok: true });
    }
    if (path === "/api/push/unsubscribe" && deps.push) {
      if (typeof body.endpoint !== "string") throw new HttpError(400, "Invalid subscription");
      await deps.push.unsubscribe(body.endpoint);
      return json(res, 200, { ok: true });
    }
    if (!sessionRoute?.[2]) throw new HttpError(404, "Not found");
    const session = findSession(sessionRoute[1]!);

    if (sessionRoute[2] === "read") {
      const shownRequest = typeof body.requestId === "string" ? body.requestId : undefined;
      const shownPi = typeof body.piSessionId === "string" ? body.piSessionId : undefined;
      // An old card must not dismiss a newer request or another conversation.
      if (session.piSessionId !== shownPi || visibleAttention(session)?.requestId !== shownRequest) throw new HttpError(409, "Request changed; reload the page");
      await deps.acknowledge(session.id, shownRequest, shownRequest !== undefined, { piSessionId: shownPi });
      return json(res, 200, { status: "accepted" });
    }

    const target = boundTarget(session, body);
    const envelope = { ...target, version: 1, id: randomUUID() };
    if (sessionRoute[2] === "answer") {
      const request = parseInteractionRequest({ ...envelope, kind: "submit-answer", toolCallId: body.toolCallId, answers: body.answers });
      if (request?.kind !== "submit-answer") throw new HttpError(400, "Invalid answer");
      const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
      return write(res, () => deps.submitAnswer(target, request.toolCallId, request.answers), async () => {
        if (requestId) await deps.acknowledge(session.id, requestId, true, { piSessionId: target.piSessionId });
        await deps.touch(session.id);
      });
    }
    const request = parseInteractionRequest({ ...envelope, kind: "send-message", text: body.text, delivery: body.delivery });
    if (request?.kind !== "send-message") throw new HttpError(400, "Invalid reply");
    return write(res, () => deps.sendMessage(target, request.text, request.delivery), () => deps.touch(session.id));
  };

  const detail = async (session: RuntimeSession, withConversation: boolean) => {
    const row = inboxRow(session.id);
    const target = interactionTarget(session);
    if (!target) return { session: row, unavailable: session.status === "stopped" || session.status === "error" ? "Session is not running" : "Restart this session to reply from Hub" };
    try {
      const [state, conversation] = await Promise.all([deps.loadState(target), withConversation ? deps.loadConversation(target) : undefined]);
      return {
        session: row,
        interaction: {
          canAnswer: state.answerChannel === "rpiv-events" && state.questionProtocol && !state.questionUnavailableReason,
          ...(state.answerChannel ? {} : { answerUnavailable: "Reload Pi in this session to answer from Hub" }),
          ...(state.questionUnavailableReason ? { answerUnavailable: state.questionUnavailableReason } : {}),
          messageDelivery: state.messageDelivery ?? "idle",
          ...(state.lastMessage ? { lastMessage: state.lastMessage } : {}),
          pending: state.pending.map((request) => ({
            toolCallId: request.toolCallId,
            questions: request.params.questions.map((question) => {
              const { ask, conditions, context } = formatQuestionText(question.question);
              return { ...question, ask, conditions, context };
            }),
          })),
        },
        ...(conversation ? { conversation: conversation.items.map(({ id, role, text, truncated }) => ({ id, role, text, ...(truncated ? { truncated } : {}) })) } : {}),
      };
    } catch (error) {
      return { session: row, unavailable: error instanceof Error ? error.message : "Session interaction unavailable" };
    }
  };

  const server = createServer((req, res) => {
    routes(req, res).catch((error: unknown) => {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else json(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
    });
  });

  return {
    server,
    publish() {
      if (!streams.size) return;
      const { key, frame } = snapshotFrame();
      if (key === published) return;
      published = key;
      for (const stream of streams) stream.write(frame);
    },
    async close() {
      clearInterval(ping);
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
    },
  };
}

const baseHeaders = {
  // frame-ancestors: another page must not frame the inbox and steer taps onto its buttons.
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > WEB_BODY_CAP) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
  if (!isObject(value)) throw new HttpError(400, "Invalid JSON");
  return value;
}
