// Transcript state for the session screen. Pure data: no DOM and no network, so Node can test it.
// The merge follows the dashboard's ConversationTranscriptPanel.accept() in src/tui/conversation.ts.

export function newChat() {
  return { branchId: undefined, before: undefined, items: [], following: true, fresh: false };
}

export function clearChat(chat) {
  Object.assign(chat, newChat());
}

const sameItem = (a, b) => a.text === b.text && a.role === b.role && a.truncated === b.truncated && a.at === b.at && a.toolCallId === b.toolCallId;

/**
 * Merge a page into the transcript. `older` is a page loaded with the transcript's `before` cursor.
 * Returns the items added at the end, which are the only ones that can be a reply the user just sent.
 */
export function acceptPage(chat, page, older = false) {
  if (older) {
    // The session moved to another branch while this page was loading.
    if (chat.branchId !== page.branchId) return [];
  } else if (chat.branchId !== undefined && chat.branchId !== page.branchId) clearChat(chat);

  const shown = new Set(chat.items.map((item) => item.id));
  let added = page.items.filter((item) => !shown.has(item.id));
  if (!older && chat.items.length && added.length === page.items.length && added.length) {
    // More than a page arrived since the last poll. A gap is never spliced into the transcript:
    // a reader keeps their place, and a follower restarts at the newest page.
    if (!chat.following) { chat.fresh = true; return []; }
    clearChat(chat);
    added = page.items;
  }

  // An empty transcript, new or just replaced, has no history cursor yet, whatever branch it has seen.
  if (older || !chat.items.length) chat.before = page.before;
  const updates = new Map(page.items.map((item) => [item.id, item]));
  const changed = chat.items.some((item) => updates.has(item.id) && !sameItem(item, updates.get(item.id)));
  // The array keeps its identity when nothing differs, so an unchanged poll rebuilds nothing.
  if (added.length || changed) {
    // Unchanged items keep their identity, so the page rebuilds only what differs.
    const kept = changed ? chat.items.map((item) => updates.has(item.id) && !sameItem(item, updates.get(item.id)) ? updates.get(item.id) : item) : chat.items;
    chat.items = older ? [...added, ...kept] : [...kept, ...added];
  }
  chat.branchId = page.branchId;
  if (older) return [];
  if (added.length && !chat.following) chat.fresh = true;
  return added;
}

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
