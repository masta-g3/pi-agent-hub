import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { createAttentionDeliveryState, observeAttentionDelivery, type AttentionDeliveryState } from "../app/attention-delivery.js";
import { loadStore, updateStore, type JsonStore } from "../core/atomic-json.js";
import { isObject } from "../core/session-interaction.js";
import { webPushPath } from "../core/paths.js";
import type { RuntimeSession } from "../core/types.js";
import { boundedText, buildInboxSnapshot } from "./inbox.js";
import type { PushSubscriptionInput } from "./server.js";

const MAX_SUBSCRIPTIONS = 16;
const PUSH_TTL_SECONDS = 3_600;
const VAPID_LIFETIME_SECONDS = 12 * 3_600;
// Push services require a contact URL in the token; Hub has no operator address to offer.
const VAPID_SUBJECT = "https://github.com/masta-g3/pi-agent-hub";
const KIND_LABELS = { question: "Question", ready: "Ready", blocked: "Blocked" } as const;

export interface PushMessage { title: string; body: string; tag: string; url: string }
interface VapidKeys { publicKey: string; privateKey: string }
interface PushSubscription extends PushSubscriptionInput { createdAt: number }
interface PushStore { version: 1; vapid?: VapidKeys; subscriptions: PushSubscription[] }

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** RFC 8291 `aes128gcm` body for one push message; `keys` exists so tests can reproduce the RFC example. */
export function encryptPushPayload(plaintext: Buffer, subscription: { p256dh: string; auth: string }, keys: { salt?: Buffer; privateKey?: Buffer } = {}): Buffer {
  const uaPublic = Buffer.from(subscription.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.auth, "base64url");
  const salt = keys.salt ?? randomBytes(16);
  const ecdh = createECDH("prime256v1");
  if (keys.privateKey) ecdh.setPrivateKey(keys.privateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  // computeSecret throws for a point that is not on P-256.
  const secret = ecdh.computeSecret(uaPublic);
  const one = Buffer.from([1]);
  const ikm = hmac(hmac(authSecret, secret), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, one]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), one])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), one])).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the single, final record.
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** RFC 8292 `Authorization` value proving the push comes from the server the device subscribed to. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1_000) + VAPID_LIFETIME_SECONDS, sub: VAPID_SUBJECT })}`;
  const point = Buffer.from(vapid.publicKey, "base64url");
  const key = createPrivateKey({ format: "jwk", key: {
    kty: "EC", crv: "P-256", d: vapid.privateKey, x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url"),
  } });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${unsigned}.${signature}, k=${vapid.publicKey}`;
}

function pushStore(path: string): JsonStore<PushStore> {
  return {
    path,
    empty: () => ({ version: 1, subscriptions: [] }),
    parse(value) {
      const vapid = isObject(value) && isObject(value.vapid) && typeof value.vapid.publicKey === "string" && typeof value.vapid.privateKey === "string"
        ? { publicKey: value.vapid.publicKey, privateKey: value.vapid.privateKey } : undefined;
      const subscriptions = isObject(value) && Array.isArray(value.subscriptions) ? value.subscriptions.filter(validSubscription) : [];
      return { version: 1, ...(vapid ? { vapid } : {}), subscriptions };
    },
  };
}

function validSubscription(value: unknown): value is PushSubscription {
  if (!isObject(value) || typeof value.endpoint !== "string" || typeof value.p256dh !== "string" || typeof value.auth !== "string") return false;
  return /^https:\/\/[^\s]{1,2000}$/u.test(value.endpoint) && URL.canParse(value.endpoint)
    && Buffer.from(value.p256dh, "base64url").length === 65 && Buffer.from(value.auth, "base64url").length === 16;
}

export interface PushSender {
  publicKey(): Promise<string>;
  subscribe(subscription: PushSubscriptionInput): Promise<void>;
  unsubscribe(endpoint: string): Promise<void>;
  /** Sends to every device; returns one line per failed delivery. */
  notify(message: PushMessage): Promise<string[]>;
}

export function createPushSender(options: { path?: string; fetch?: typeof fetch; now?: () => number } = {}): PushSender {
  const store = pushStore(options.path ?? webPushPath());
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const vapidKeys = async (): Promise<VapidKeys> => {
    const current = (await loadStore(store)).vapid;
    if (current) return current;
    return (await updateStore(store, (value) => {
      if (value.vapid) return value;
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      return { ...value, vapid: { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") } };
    })).vapid!;
  };
  const remove = (endpoints: readonly string[]) => updateStore(store, (value) => ({ ...value, subscriptions: value.subscriptions.filter((item) => !endpoints.includes(item.endpoint)) }));

  return {
    async publicKey() { return (await vapidKeys()).publicKey; },
    async subscribe(subscription) {
      const entry = { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth, createdAt: now() };
      if (!/^https:/u.test(entry.endpoint)) throw new Error("Push endpoint must use https");
      if (!validSubscription(entry)) throw new Error("Invalid push subscription");
      await updateStore(store, (value) => ({
        ...value,
        subscriptions: [...value.subscriptions.filter((item) => item.endpoint !== entry.endpoint), entry].slice(-MAX_SUBSCRIPTIONS),
      }));
    },
    async unsubscribe(endpoint) { await remove([endpoint]); },
    async notify(message) {
      const { subscriptions } = await loadStore(store);
      if (!subscriptions.length) return [];
      const vapid = await vapidKeys();
      const payload = Buffer.from(JSON.stringify(message));
      const gone: string[] = [];
      const failures: string[] = [];
      await Promise.all(subscriptions.map(async (subscription) => {
        try {
          const response = await send(subscription.endpoint, {
            method: "POST",
            headers: {
              Authorization: vapidAuthorization(subscription.endpoint, vapid, now()),
              "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(PUSH_TTL_SECONDS), Urgency: "high",
            },
            body: new Uint8Array(encryptPushPayload(payload, subscription)),
            signal: AbortSignal.timeout(10_000),
          });
          // The push service says this device unsubscribed or expired.
          if (response.status === 404 || response.status === 410) gone.push(subscription.endpoint);
          else if (!response.ok) failures.push(`${subscription.endpoint}: HTTP ${response.status}`);
        } catch (error) {
          failures.push(`${subscription.endpoint}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }));
      if (gone.length) await remove(gone);
      return failures;
    },
  };
}

/** Announces each producer request once, and only when the phone inbox shows it. */
export function createRequestNotifier(initial: RuntimeSession[], announce: (message: PushMessage) => void, now = Date.now()): { observe(sessions: RuntimeSession[], now?: number): void } {
  // Requests that already exist when the server starts are not news.
  let state: AttentionDeliveryState = createAttentionDeliveryState(initial, now);
  return {
    observe(sessions, at = Date.now()) {
      const observation = observeAttentionDelivery(state, sessions, at);
      state = observation.state;
      if (!observation.fresh.length) return;
      const shown = new Map(buildInboxSnapshot(sessions, at).tiers.flatMap((tier) => tier.sessions).map((row) => [row.id, row]));
      for (const entry of observation.fresh) {
        const row = shown.get(entry.sessionId);
        if (row?.attention?.requestId !== entry.requestId) continue;
        announce({
          title: row.title,
          body: `${KIND_LABELS[row.attention.kind]} · ${boundedText(row.attention.text, 240)}`,
          tag: `${row.id}:${entry.requestId}`,
          url: `/#/s/${row.id}`,
        });
      }
    },
  };
}
