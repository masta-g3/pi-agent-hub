import test from "node:test";
import assert from "node:assert/strict";
import { readConversation, type ConversationItem } from "../src/core/conversation.js";
import { acceptPage, newTranscript } from "../src/core/transcript.js";

interface Sent { localId: number; text: string; delivery: "send" | "steer" | "followUp"; status: string }

// The page ships as plain browser modules, so the test loads the same file the phone does.
const { settleSent } = await import(new URL("../../web/chat.js", import.meta.url).href) as {
  settleSent(sent: Sent[], appended: ConversationItem[]): Sent[];
};

type Entry = { type: "message"; id: string; message: { role: string; content: string } };
const entry = (id: string, role: string, content: string): Entry => ({ type: "message", id, message: { role, content } });
/** A branch of `count` alternating messages, `m1` first. */
const branch = (count: number, text = (index: number) => `message ${index}`): Entry[] =>
  Array.from({ length: count }, (_, index) => entry(`m${index + 1}`, index % 2 ? "assistant" : "user", text(index + 1)));
const newest = (entries: Entry[], branchId = "b1") => readConversation(entries, { branchId });
const earlier = (entries: Entry[], before: string, branchId = "b1") => readConversation(entries, { branchId, before });

const sent = (localId: number, text: string, delivery: Sent["delivery"] = "followUp"): Sent => ({ localId, text, delivery, status: "accepted" });
const user = (id: string, text: string): ConversationItem => ({ id, role: "user", text });

test("a queued reply is retired by its own recorded message only", () => {
  const queue = [sent(1, "please also  fix\nthe resync ")];
  assert.deepEqual(settleSent(queue, [user("m1", "something else")]), queue);
  assert.deepEqual(settleSent(queue, [{ id: "m2", role: "assistant", text: "please also fix the resync" }]), queue);
  assert.deepEqual(settleSent(queue, [{ id: "m3", role: "answer", text: "please also fix the resync" }]), queue);
  assert.deepEqual(settleSent(queue, []), queue);
  // Whitespace differences still match.
  assert.deepEqual(settleSent(queue, [user("m4", "  please also fix the resync")]), []);
});

test("two equal queued replies retire one per recorded message, across polls", () => {
  const entries = branch(2);
  const chat = newTranscript();
  acceptPage(chat, newest(entries));
  let queue = [sent(1, "go on"), sent(2, "go on")];

  entries.push(entry("m3", "user", "go on"));
  queue = settleSent(queue, acceptPage(chat, newest(entries)));
  assert.deepEqual(queue.map((item) => item.localId), [2]);
  // The same recorded message must not retire the second reply on later polls.
  for (let poll = 0; poll < 3; poll += 1) queue = settleSent(queue, acceptPage(chat, newest(entries)));
  assert.deepEqual(queue.map((item) => item.localId), [2]);

  entries.push(entry("m4", "assistant", "working"), entry("m5", "user", "go on"));
  queue = settleSent(queue, acceptPage(chat, newest(entries)));
  assert.deepEqual(queue, []);
});

test("earlier history never retires a queued reply", () => {
  const entries = branch(44);
  entries[2] = entry("m3", "user", "go on");
  const chat = newTranscript();
  acceptPage(chat, newest(entries));
  let queue = [sent(1, "go on")];
  while (chat.before !== undefined) queue = settleSent(queue, acceptPage(chat, earlier(entries, chat.before), true));
  assert.equal(chat.items.some((item) => item.id === "m3" && item.text === "go on"), true);
  assert.deepEqual(queue.map((item) => item.localId), [1]);
});

test("a reply to an idle agent is retired by the next recorded user message, whatever its text", () => {
  // Pi may expand a template, so the recorded text can differ from what was typed.
  const queue = [sent(1, "review this", "send"), sent(2, "later", "followUp")];
  assert.deepEqual(settleSent(queue, [{ id: "m1", role: "assistant", text: "review this" }]).map((item) => item.localId), [1, 2]);
  assert.deepEqual(settleSent(queue, [user("m2", "Review the change in full: review this")]).map((item) => item.localId), [2]);
  // A reply whose delivery is unknown must not swallow the record of the retry that follows it.
  const retry = [{ ...sent(1, "first try", "send"), status: "unknown" }, sent(2, "second try", "send")];
  assert.deepEqual(settleSent(retry, [user("m6", "second try")]).map((item) => item.localId), [1]);
  // One recorded message retires one reply.
  assert.deepEqual(settleSent([sent(1, "a", "send"), sent(2, "a", "steer")], [user("m3", "a")]).map((item) => item.localId), [2]);
  assert.deepEqual(settleSent([sent(1, "a", "steer"), sent(2, "b", "steer")], [user("m4", "b"), user("m5", "a")]), []);
});
