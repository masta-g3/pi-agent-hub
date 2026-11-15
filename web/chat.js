// Replies the phone shows before Pi records them. Pure data, so Node can test it.
// The transcript merge itself is shared with the dashboard: see src/core/transcript.ts, served at /transcript.js.

const collapse = (text) => text.trim().replace(/\s+/gu, " ");

/**
 * Replies shown before Pi recorded them, minus the ones a newly recorded user message replaces.
 * A reply to an idle agent is the next user message whatever its text, because Pi may expand it;
 * a steered or queued reply is recorded as typed. Each message retires one reply, oldest first.
 */
export function settleSent(sent, appended) {
  let remaining = sent;
  for (const item of appended) {
    if (item.role !== "user") continue;
    const text = collapse(item.text);
    // The reply with this exact text first, so a retry's record does not retire an earlier, different reply.
    let index = remaining.findIndex((reply) => collapse(reply.text) === text);
    if (index === -1) index = remaining.findIndex((reply) => reply.delivery === "send");
    if (index !== -1) remaining = remaining.filter((_, at) => at !== index);
  }
  return remaining;
}

const SKILL_HEAD = /^<skill name="([^"]+)" location="[^"]+">\n/u;
const FILE_HEAD = /^<file name="([^"]+)">/u;
const baseName = (path) => path.split("/").filter(Boolean).at(-1) ?? path;

/** Pi's skill block, matched as Pi's own parser does: the first `\n</skill>` followed by the end or a blank line. */
function skillPart(text) {
  const head = SKILL_HEAD.exec(text);
  if (!head) return undefined;
  for (let end = text.indexOf("\n</skill>", head[0].length - 1); end !== -1; end = text.indexOf("\n</skill>", end + 1)) {
    const rest = text.slice(end + 9);
    if (rest === "" || (rest.startsWith("\n\n") && rest.length > 2)) {
      return { part: { kind: "skill", name: head[1], body: text.slice(head[0].length, end) }, rest: rest.slice(2) };
    }
  }
  return undefined;
}

/**
 * One leading `@file` block. Pi closes each with `</file>` on its own line, then a newline. A body or typed text can
 * mention that tag too, so a close must be followed by another block or by text with no further close; otherwise
 * the message is ambiguous and stays as typed.
 */
function filePart(text) {
  const head = FILE_HEAD.exec(text);
  if (!head) return undefined;
  const ends = [];
  for (let end = text.indexOf("</file>\n", head[0].length); end !== -1; end = text.indexOf("</file>\n", end + 1)) ends.push(end);
  // A close followed by the next block is certain; otherwise the only close must be the last mention of the tag.
  const end = ends.find((at) => text.startsWith("<file name=\"", at + 8))
    ?? (ends.length === 1 && !text.slice(ends[0] + 8).includes("</file>") ? ends[0] : undefined);
  if (end === undefined) return undefined;
  return { part: { kind: "file", name: baseName(head[1]), body: text.slice(head[0].length, end).replace(/^\n|\n$/gu, "") }, rest: text.slice(end + 8) };
}

/**
 * What a person typed, apart from what Pi expanded into the message: a `/skill` invocation and `@file` attachments.
 * Text that does not match Pi's exact block shapes stays as typed.
 */
export function splitPrompt(text) {
  const attachments = [];
  let rest = text;
  for (let found = filePart(rest); found; found = filePart(rest)) { attachments.push(found.part); rest = found.rest; }
  const skill = skillPart(rest);
  if (skill) { attachments.push(skill.part); rest = skill.rest; }
  return { attachments, text: attachments.length ? rest.trim() : text };
}
