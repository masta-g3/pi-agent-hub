import { createHash } from "node:crypto";

export interface ConversationItem {
  id: string;
  role: "user" | "assistant" | "question" | "answer";
  text: string;
  truncated?: boolean;
  toolCallId?: string;
}

export interface ConversationPage {
  branchId: string;
  revision: string;
  items: ConversationItem[];
  before?: string;
}

const ITEM_BYTES = 64 * 1024;
const PAGE_BYTES = 240 * 1024;
const SHORTENED = "\n\nContent shortened — Open in Pi";

type RecordValue = Record<string, unknown>;
type Question = { question: string; options: { label: string; description: string }[]; multiSelect?: boolean };

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep Markdown whitespace, but never transport terminal commands from message text. */
export function conversationText(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1bP[^\x1b]*(?:\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b[@-_]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "");
}

function item(id: string, role: ConversationItem["role"], source: string): ConversationItem | undefined {
  const text = conversationText(source);
  if (!text.trim()) return undefined;
  const bytes = Buffer.from(text);
  if (bytes.length <= ITEM_BYTES) return { id, role, text };
  let end = ITEM_BYTES - Buffer.byteLength(SHORTENED);
  // Do not split a multibyte UTF-8 character at the limit.
  while ((bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { id, role, text: bytes.subarray(0, end).toString("utf8") + SHORTENED, truncated: true };
}

function questions(value: unknown): Question[] | undefined {
  if (!record(value) || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 4) return;
  const result: Question[] = [];
  for (const q of value.questions) {
    if (!record(q) || typeof q.question !== "string" || !q.question.trim()
      || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4
      || (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean")) return;
    const options: Question["options"] = [];
    for (const option of q.options) {
      if (!record(option) || typeof option.label !== "string" || !option.label.trim() || typeof option.description !== "string") return;
      options.push({ label: option.label, description: option.description });
    }
    if (new Set(options.map((o) => o.label)).size !== options.length) return;
    result.push({ question: q.question, options, ...(q.multiSelect === true ? { multiSelect: true } : {}) });
  }
  return result;
}

function answerText(details: unknown, params: Question[]): string | undefined {
  if (!record(details) || typeof details.cancelled !== "boolean" || !Array.isArray(details.answers)
    || details.answers.length > params.length || details.error !== undefined
    || (details.globalNote !== undefined && typeof details.globalNote !== "string")) return;
  if (details.cancelled) return "Questionnaire cancelled.";
  const seen = new Set<number>();
  const answers: { index: number; text: string }[] = [];
  for (const answer of details.answers) {
    if (!record(answer) || !Number.isInteger(answer.questionIndex)) return;
    const index = answer.questionIndex as number;
    const q = params[index];
    if (!q || seen.has(index) || answer.question !== q.question || (answer.notes !== undefined && typeof answer.notes !== "string")) return;
    seen.add(index);
    let response: string;
    if (answer.kind === "option") {
      if (q.multiSelect || typeof answer.answer !== "string" || !q.options.some((o) => o.label === answer.answer)) return;
      response = answer.answer;
    } else if (answer.kind === "custom") {
      if (typeof answer.answer !== "string" || !answer.answer.trim()) return;
      response = answer.answer;
    } else if (answer.kind === "multi") {
      if (!q.multiSelect || answer.answer !== null || !Array.isArray(answer.selected)
        || answer.selected.some((label) => typeof label !== "string" || !q.options.some((o) => o.label === label))
        || new Set(answer.selected).size !== answer.selected.length) return;
      response = answer.selected.length ? answer.selected.join(", ") : "No options selected.";
    } else return;
    const note = typeof answer.notes === "string" && answer.notes.trim() ? `\nNotes: ${answer.notes}` : "";
    answers.push({ index, text: `${q.question}\n${response}${note}` });
  }
  const sections = answers.sort((a, b) => a.index - b.index).map((a) => a.text);
  if (typeof details.globalNote === "string" && details.globalNote.trim()) sections.push(`Note: ${details.globalNote}`);
  return sections.length ? sections.join("\n\n") : undefined;
}

/** Projects only the supplied active branch. It never reads or mutates Pi session files. */
export function readConversation(
  branch: readonly unknown[],
  options: { branchId: string; before?: string; limit?: number },
): ConversationPage {
  const items: ConversationItem[] = [];
  const pending = new Map<string, Question[]>();
  const push = (value: ConversationItem | undefined) => { if (value) items.push(value); };
  for (const entry of branch) {
    if (!record(entry) || entry.type !== "message" || typeof entry.id !== "string" || !record(entry.message)) continue;
    const message = entry.message;
    if (message.role === "user" || message.role === "assistant") {
      if (message.stopReason === "pending") continue;
      const content = message.content;
      const body = typeof content === "string" ? content : Array.isArray(content)
        ? content.filter((block) => record(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n")
        : "";
      push(item(entry.id, message.role, body));
      if (message.role !== "assistant" || !Array.isArray(content)) continue;
      for (const block of content) {
        if (!record(block) || block.type !== "toolCall" || block.name !== "ask_user_question" || typeof block.id !== "string") continue;
        const params = questions(block.arguments);
        if (!params || pending.has(block.id)) continue;
        pending.set(block.id, params);
        const exchange = item(`${entry.id}:question:${block.id}`, "question", params.map((q) => [q.question, ...q.options.map((o, i) => `${i + 1}. ${o.label} — ${o.description}`)].join("\n")).join("\n\n"));
        if (exchange) push({ ...exchange, toolCallId: block.id });
      }
    } else if (message.role === "toolResult" && message.toolName === "ask_user_question" && typeof message.toolCallId === "string" && message.isError !== true) {
      const params = pending.get(message.toolCallId);
      if (!params) continue;
      const text = answerText(message.details, params);
      if (text !== undefined) push(item(entry.id, "answer", text));
      pending.delete(message.toolCallId);
    }
  }

  let end = items.length;
  if (options.before !== undefined) {
    end = items.findIndex((item) => item.id === options.before);
    if (end === -1) throw new Error("Conversation cursor is no longer on the current branch");
  }
  const limit = Math.min(20, Math.max(1, Math.floor(options.limit ?? 20)));
  let start = end;
  let bytes = 0;
  while (start > 0 && end - start < limit) {
    const size = Buffer.byteLength(JSON.stringify(items[start - 1])) + 1;
    if (bytes + size > PAGE_BYTES) break;
    bytes += size;
    start -= 1;
  }
  const page: ConversationPage = {
    branchId: options.branchId,
    revision: createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 24),
    items: items.slice(start, end),
  };
  if (start > 0 && start < end) page.before = items[start]!.id;
  return page;
}
