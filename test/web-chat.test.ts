import test from "node:test";
import assert from "node:assert/strict";
import { readConversation, type ConversationItem, type ConversationPage } from "../src/core/conversation.js";

interface Chat { branchId?: string; before?: string; items: ConversationItem[]; following: boolean; fresh: boolean }
interface Sent { localId: number; text: string; delivery: "send" | "steer" | "followUp"; status: string }

// The page ships as plain browser modules, so the test loads the same file the phone does.
const { newChat, acceptPage, settleSent } = await import(new URL("../../web/chat.js", import.meta.url).href) as {
  newChat(): Chat;
  acceptPage(chat: Chat, page: ConversationPage, older?: boolean): ConversationItem[];
  settleSent(sent: Sent[], appended: ConversationItem[]): Sent[];
};

type Entry = { type: "message"; id: string; message: { role: string; content: string } };
const entry = (id: string, role: string, content: string): Entry => ({ type: "message", id, message: { role, content } });
/** A branch of `count` alternating messages, `m1` first. */
const branch = (count: number, text = (index: number) => `message ${index}`): Entry[] =>
  Array.from({ length: count }, (_, index) => entry(`m${index + 1}`, index % 2 ? "assistant" : "user", text(index + 1)));
const newest = (entries: Entry[], branchId = "b1") => readConversation(entries, { branchId });
const earlier = (entries: Entry[], before: string, branchId = "b1") => readConversation(entries, { branchId, before });
const ids = (chat: Chat) => chat.items.map((item) => item.id);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);

test("the first page fills the transcript and an unchanged poll changes nothing", () => {
  const entries = branch(5);
  const chat = newChat();
  assert.deepEqual(acceptPage(chat, newest(entries)).map((item) => item.id), range(1, 5));
  assert.deepEqual(ids(chat), range(1, 5));
  assert.equal(chat.branchId, "b1");
  assert.equal(chat.before, undefined);
  const items = chat.items;
  const again = acceptPage(chat, newest(entries));
  assert.deepEqual(again, []);
  // Identity is kept, so the page rebuilds no element.
  assert.equal(chat.items, items);
  assert.equal(chat.fresh, false);
});

test("a session opened before its first message still gets its history cursor", () => {
  const chat = newChat();
  assert.deepEqual(acceptPage(chat, newest([])), []);
  assert.equal(chat.branchId, "b1");
  // The phone slept; more than a page was recorded before the next poll.
  acceptPage(chat, newest(branch(30)));
  assert.deepEqual(ids(chat), range(11, 30));
  assert.equal(chat.before, "m11");
});

test("a new message is appended and reported once", () => {
  const entries = branch(3);
  const chat = newChat();
  acceptPage(chat, newest(entries));
  entries.push(entry("m4", "assistant", "done"));
  assert.deepEqual(acceptPage(chat, newest(entries)).map((item) => item.id), ["m4"]);
  assert.deepEqual(ids(chat), range(1, 4));
  assert.deepEqual(acceptPage(chat, newest(entries)), []);
  // Following the end, new content is not flagged as unseen.
  assert.equal(chat.fresh, false);
  chat.following = false;
  entries.push(entry("m5", "user", "more"));
  acceptPage(chat, newest(entries));
  assert.equal(chat.fresh, true);
  assert.deepEqual(ids(chat), range(1, 5));
});

test("a message whose text changed is replaced in place", () => {
  const entries = branch(3);
  const chat = newChat();
  acceptPage(chat, newest(entries));
  const before = chat.items;
  entries[1] = entry("m2", "assistant", "rewritten");
  const result = acceptPage(chat, newest(entries));
  assert.deepEqual(result, []);
  assert.deepEqual(ids(chat), range(1, 3));
  assert.equal(chat.items[1]!.text, "rewritten");
  // Only the changed message is a new object; its neighbors keep their elements.
  assert.equal(chat.items[0], before[0]);
  assert.equal(chat.items[2], before[2]);
  assert.notEqual(chat.items[1], before[1]);
});

test("an earlier page is prepended although its revision equals the newest page's", () => {
  const entries = branch(45);
  const chat = newChat();
  const first = newest(entries);
  acceptPage(chat, first);
  assert.deepEqual(ids(chat), range(26, 45));
  assert.equal(chat.before, "m26");

  const older = earlier(entries, chat.before!);
  // The revision covers the whole branch, so it cannot tell pages apart.
  assert.equal(older.revision, first.revision);
  // An earlier page adds nothing at the end, so it can never be taken for a reply just sent.
  assert.deepEqual(acceptPage(chat, older, true), []);
  assert.deepEqual(ids(chat), range(6, 45));
  assert.equal(chat.before, "m6");

  // A newest-page poll must not move the history cursor back.
  acceptPage(chat, newest(entries));
  assert.equal(chat.before, "m6");
  assert.deepEqual(ids(chat), range(6, 45));

  acceptPage(chat, earlier(entries, chat.before!), true);
  assert.deepEqual(ids(chat), range(1, 45));
  assert.equal(chat.before, undefined);
  // Loading the same earlier page twice adds nothing.
  acceptPage(chat, older, true);
  assert.deepEqual(ids(chat), range(1, 45));
});

test("a page limited by size carries fewer than twenty items and still pages to the start", () => {
  const entries = branch(12, (index) => `${index} ${"x".repeat(50_000)}`);
  const chat = newChat();
  const first = newest(entries);
  assert.ok(first.items.length < 12 && first.items.length > 0);
  acceptPage(chat, first);
  let pages = 1;
  while (chat.before !== undefined) {
    acceptPage(chat, earlier(entries, chat.before), true);
    pages += 1;
    assert.ok(pages < 20, "paging must end");
  }
  assert.deepEqual(ids(chat), range(1, 12));
  assert.ok(pages > 2);
});

test("a different branch replaces the transcript", () => {
  const chat = newChat();
  acceptPage(chat, newest(branch(30)));
  chat.following = false;
  chat.fresh = true;
  const forked = [entry("f1", "user", "new start"), entry("f2", "assistant", "ok")];
  const result = acceptPage(chat, newest(forked, "b2"));
  assert.deepEqual(result.map((item) => item.id), ["f1", "f2"]);
  assert.deepEqual(ids(chat), ["f1", "f2"]);
  assert.equal(chat.branchId, "b2");
  assert.equal(chat.before, undefined);
  assert.equal(chat.following, true);
  assert.equal(chat.fresh, false);
  // An earlier page that was requested on the old branch is refused.
  acceptPage(chat, earlier(branch(30), "m11"), true);
  assert.deepEqual(ids(chat), ["f1", "f2"]);
  assert.equal(chat.before, undefined);
});

test("more than a page of new messages replaces the transcript when following", () => {
  const entries = branch(10);
  const chat = newChat();
  acceptPage(chat, newest(entries));
  for (let index = 11; index <= 45; index += 1) entries.push(entry(`m${index}`, index % 2 ? "user" : "assistant", `message ${index}`));
  const result = acceptPage(chat, newest(entries));
  // No gap is spliced in: the transcript restarts at the newest page, with history reloadable.
  assert.deepEqual(ids(chat), range(26, 45));
  assert.deepEqual(result.map((item) => item.id), range(26, 45));
  assert.equal(chat.before, "m26");
});

test("a page that shares nothing with the transcript replaces it, even when it is the whole branch", () => {
  const chat = newChat();
  acceptPage(chat, newest(branch(4)));
  // Same branch id, different messages, and no earlier page: the shown messages are gone.
  const rewritten = [entry("n1", "user", "after compaction"), entry("n2", "assistant", "ok")];
  assert.deepEqual(acceptPage(chat, newest(rewritten)).map((item) => item.id), ["n1", "n2"]);
  assert.deepEqual(ids(chat), ["n1", "n2"]);
});

test("more than a page of new messages keeps the reader's place when scrolled up", () => {
  const entries = branch(10);
  const chat = newChat();
  acceptPage(chat, newest(entries));
  chat.following = false;
  for (let index = 11; index <= 45; index += 1) entries.push(entry(`m${index}`, index % 2 ? "user" : "assistant", `message ${index}`));
  const result = acceptPage(chat, newest(entries));
  assert.deepEqual(result, []);
  assert.deepEqual(ids(chat), range(1, 10));
  assert.equal(chat.fresh, true);
  // Going to the end follows again and loads the newest page.
  chat.following = true;
  assert.deepEqual(acceptPage(chat, newest(entries)).map((item) => item.id), range(26, 45));
  assert.deepEqual(ids(chat), range(26, 45));
  assert.equal(chat.fresh, false);
});

// ---- local replies ----

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
  const chat = newChat();
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
  const chat = newChat();
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
