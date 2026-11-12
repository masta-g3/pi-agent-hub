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
