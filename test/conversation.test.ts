import assert from "node:assert/strict";
import test from "node:test";
import { readConversation, conversationText, lastAssistantText } from "../src/core/conversation.js";

const entry = (id: string, message: unknown) => ({ type: "message", id, message });
const text = (text: string) => ({ type: "text", text });
const question = { question: "Which login?", header: "Login", options: [{ label: "Email", description: "Use a link", preview: "SECRET PREVIEW" }, { label: "Password", description: "Use a password" }] };
const call = { type: "toolCall", id: "call-1", name: "ask_user_question", arguments: { questions: [question] } };

test("conversation includes authored text but not thinking, tools, metadata or summaries", () => {
  const result = readConversation([
    entry("u", { role: "user", content: [text("Explain **login**."), { type: "image", data: "secret" }] }),
    entry("a", { role: "assistant", content: [{ type: "thinking", thinking: "secret reasoning" }, text("First paragraph.\n\nSecond paragraph."), { type: "toolCall", name: "bash", arguments: { command: "secret" } }] }),
    entry("tool", { role: "toolResult", toolName: "bash", content: [text("secret output")] }),
    entry("empty", { role: "assistant", content: [{ type: "thinking", thinking: "secret" }] }),
    { type: "compaction", id: "summary", summary: "secret summary" },
    { type: "custom_message", id: "custom", content: "secret" },
  ], { branchId: "branch" });
  assert.deepEqual(result.items.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Explain **login**." },
    { role: "assistant", text: "First paragraph.\n\nSecond paragraph." },
  ]);
  assert.equal(result.branchId, "branch");
  assert.equal(result.before, undefined);
});

test("questions and canonical native answers form readable exchanges without duplicate previews", () => {
  const result = readConversation([
    entry("ask", { role: "assistant", content: [text("Choose a method."), call] }),
    entry("answer", { role: "toolResult", toolName: "ask_user_question", toolCallId: "call-1", content: [text("raw tool envelope")], details: { cancelled: false, answers: [{ questionIndex: 0, question: question.question, kind: "option", answer: "Email", preview: "SECRET PREVIEW", notes: "Keep it simple." }], globalNote: "Ship it." } }),
  ], { branchId: "branch" });
  assert.deepEqual(result.items.map((x) => x.role), ["assistant", "question", "answer"]);
  assert.match(result.items[1]!.text, /Which login\?/);
  assert.match(result.items[1]!.text, /Email/);
  assert.match(result.items[2]!.text, /Email/);
  assert.match(result.items[2]!.text, /Keep it simple/);
  assert.match(result.items[2]!.text, /Ship it/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET PREVIEW|raw tool envelope/);
});

test("unmatched or malformed tool results never fabricate an answer", () => {
  for (const details of [undefined, { cancelled: false, answers: [] }, { cancelled: false, answers: [{ questionIndex: 0, question: question.question, kind: "option", answer: "Not an option" }] }, { cancelled: false, answers: [{ questionIndex: 0, question: "Another question", kind: "custom", answer: "yes" }] }]) {
    const result = readConversation([
      entry("ask", { role: "assistant", content: [call] }),
      entry("result", { role: "toolResult", toolName: "ask_user_question", toolCallId: "call-1", details }),
    ], { branchId: "b" });
    assert.equal(result.items.filter((x) => x.role === "answer").length, 0);
  }
  assert.equal(readConversation([entry("r", { role: "toolResult", toolName: "ask_user_question", toolCallId: "unknown", details: { cancelled: true, answers: [] } })], { branchId: "b" }).items.length, 0);
});

test("custom, empty multiselect and cancellation are distinct from fabricated answers", () => {
  const multi = { ...question, multiSelect: true };
  const branch = [entry("ask", { role: "assistant", content: [{ ...call, arguments: { questions: [multi] } }] })];
  const result = (details: unknown) => readConversation([...branch, entry("r", { role: "toolResult", toolName: "ask_user_question", toolCallId: "call-1", details })], { branchId: "b" });
  assert.match(result({ cancelled: false, answers: [{ questionIndex: 0, question: multi.question, kind: "multi", answer: null, selected: [] }] }).items.at(-1)!.text, /No options selected/);
  assert.match(result({ cancelled: false, answers: [{ questionIndex: 0, question: multi.question, kind: "custom", answer: "Passkeys instead" }] }).items.at(-1)!.text, /Passkeys instead/);
  assert.match(result({ cancelled: true, answers: [] }).items.at(-1)!.text, /cancelled/i);
});

test("items carry the time Pi recorded them, when it is a valid date", () => {
  const at = "2026-11-11T14:02:03.000Z";
  const result = readConversation([
    { ...entry("u", { role: "user", content: "Hi" }), timestamp: at },
    { ...entry("ask", { role: "assistant", content: [text("Choose."), call] }), timestamp: "2026-11-11T14:05:00.000Z" },
    { ...entry("bad", { role: "assistant", content: "No clock" }), timestamp: "yesterday" },
    { ...entry("number", { role: "assistant", content: "Number" }), timestamp: 1_700_000_000_000 },
    entry("none", { role: "assistant", content: "Untimed" }),
  ], { branchId: "branch" });
  assert.deepEqual(result.items.map((item) => [item.role, item.at]), [
    ["user", Date.parse(at)], ["assistant", Date.parse("2026-11-11T14:05:00.000Z")], ["question", Date.parse("2026-11-11T14:05:00.000Z")],
    ["assistant", undefined], ["assistant", undefined], ["assistant", undefined],
  ]);
  assert.equal("at" in result.items[3]!, false);
});

test("older-page cursors stay stable on append and reject foreign cursors", () => {
  const branch = Array.from({ length: 27 }, (_, i) => entry(`m${i}`, { role: "user", content: `message ${i}` }));
  const latest = readConversation(branch, { branchId: "b", limit: 20 });
  assert.equal(latest.items.length, 20);
  assert.equal(latest.items[0]!.text, "message 7");
  const older = readConversation([...branch, entry("new", { role: "user", content: "new message" })], { branchId: "b", before: latest.before, limit: 20 });
  assert.deepEqual(older.items.map((x) => x.text), branch.slice(0, 7).map((_, i) => `message ${i}`));
  assert.equal(older.before, undefined);
  assert.throws(() => readConversation(branch, { branchId: "b", before: "foreign" }), /cursor/i);
});

test("output is bounded in bytes, explicitly shortened and always makes paging progress", () => {
  const branch = Array.from({ length: 9 }, (_, i) => entry(`m${i}`, { role: "assistant", content: [text("🦊\n\"".repeat(20_000))] }));
  let before: string | undefined;
  const seen = new Set<string>();
  do {
    const page = readConversation(branch, { branchId: "b", before });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 256 * 1024);
    assert.ok(page.items.length > 0);
    for (const item of page.items) {
      assert.equal(seen.has(item.id), false);
      seen.add(item.id);
      assert.equal(item.truncated, true);
      assert.match(item.text, /Content shortened/);
      assert.doesNotMatch(item.text, /\ufffd/);
    }
    before = page.before;
  } while (before);
  assert.equal(seen.size, 9);
});

test("terminal sanitizing preserves Markdown whitespace and strips control sequences", () => {
  assert.equal(conversationText("\x1b[31mRed\x1b[0m\n\n```ts\n\tcode\n```\x07"), "Red\n\n```ts\n\tcode\n```");
  assert.equal(conversationText("\x1b]52;c;secret\x07visible"), "visible");
});

test("the latest assistant message is the newest finished text, bounded and sanitized", () => {
  const branch = [
    entry("older", { role: "assistant", content: [text("Older answer.")] }),
    entry("said", { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, text("\u001b[31mDone\u001b[0m with **parsers**."), text("Next: tests.")] }),
    entry("user", { role: "user", content: [text("Thanks")] }),
    entry("tools", { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "secret" } }] }),
    entry("result", { role: "toolResult", toolName: "bash", content: [text("secret output")] }),
    entry("pending", { role: "assistant", stopReason: "pending", content: [text("Still streaming")] }),
  ];
  // Since "Thanks" the agent has only run tools: its earlier answer no longer stands as what it said.
  assert.equal(lastAssistantText(branch, 2_000), undefined);
  const answered = branch.slice(0, 2);
  assert.equal(lastAssistantText(answered, 2_000), "Done with **parsers**.\nNext: tests.");
  assert.equal(lastAssistantText(answered, 4), "Done…");
  // Text the agent writes while working on the new message shows, with later tool calls after it.
  const working = [...branch.slice(0, 3), entry("note", { role: "assistant", content: [text("Checking the parser first.")] }), ...branch.slice(3)];
  assert.equal(lastAssistantText(working, 100), "Checking the parser first.");
  assert.equal(lastAssistantText([entry("plain", { role: "assistant", content: "Plain \u0007string" })], 100), "Plain string");
  assert.equal(lastAssistantText([entry("emoji", { role: "assistant", content: [text("😀😀😀")] })], 2), "😀😀…", "bounds count characters, not UTF-16 units");
  assert.equal(lastAssistantText(branch.slice(3), 100), undefined);
  assert.equal(lastAssistantText([], 100), undefined);
});

test("emphasized markdown keeps bold and paints inline code in the accent", async () => {
  const { renderMarkdown } = await import("../src/tui/conversation.js");
  const { darkTheme, styleToken, stripAnsi } = await import("../src/tui/theme.js");
  const lines = renderMarkdown("Run `pnpm build` for the **new** pane.", 80, darkTheme, true).join("\n");
  assert.ok(lines.includes(styleToken(darkTheme, "accent", "pnpm build")), JSON.stringify(lines));
  assert.match(lines, /\u001b\[1m(?:\u001b\[[0-9;]*m)*new/u);
  const flat = renderMarkdown("Run `pnpm build` for the **new** pane.", 80, darkTheme).join("\n");
  assert.ok(!flat.includes("\u001b[1m") && !flat.includes(styleToken(darkTheme, "accent", "pnpm build")));
  assert.equal(stripAnsi(lines), stripAnsi(flat));
});
