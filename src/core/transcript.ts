// The conversation transcript both screens show: the dashboard's Conversation view and the phone chat.
// It merges pages from `readConversation()` and nothing else. The phone loads the compiled file as is,
// so this module must import only types and use no Node API.
import type { ConversationItem, ConversationPage } from "./conversation.js";

export interface Transcript {
  branchId?: string;
  /** Cursor for the next older page; absent at the start of the conversation. */
  before?: string;
  items: ConversationItem[];
  /** The reader is at the end, so new content is shown as it arrives. */
  following: boolean;
  /** Content arrived while the reader was not at the end. */
  newMessages: boolean;
}

export function newTranscript(): Transcript {
  return { branchId: undefined, before: undefined, items: [], following: true, newMessages: false };
}

export function clearTranscript(transcript: Transcript): void {
  Object.assign(transcript, newTranscript());
}

const sameItem = (a: ConversationItem, b: ConversationItem) =>
  a.text === b.text && a.role === b.role && a.truncated === b.truncated && a.at === b.at && a.toolCallId === b.toolCallId;

/**
 * Merge a page into the transcript. `older` is a page loaded with the transcript's `before` cursor.
 * Returns the items added at the end, which are the only ones that can be a reply the user just sent.
 */
export function acceptPage(transcript: Transcript, page: ConversationPage, older = false): ConversationItem[] {
  if (older) {
    // The session moved to another branch while this page was loading.
    if (transcript.branchId !== page.branchId) return [];
  } else if (transcript.branchId !== undefined && transcript.branchId !== page.branchId) clearTranscript(transcript);

  const shown = new Set(transcript.items.map((item) => item.id));
  let added = page.items.filter((item) => !shown.has(item.id));
  if (!older && transcript.items.length && added.length && added.length === page.items.length) {
    // More than a page arrived since the last poll. A gap is never spliced into the transcript:
    // a reader keeps their place, and a follower restarts at the newest page.
    if (!transcript.following) { transcript.newMessages = true; return []; }
    clearTranscript(transcript);
    added = page.items;
  }

  // An empty transcript, new or just replaced, has no history cursor yet, whatever branch it has seen.
  if (older || !transcript.items.length) transcript.before = page.before;
  const updates = new Map(page.items.map((item) => [item.id, item]));
  const changed = transcript.items.some((item) => updates.has(item.id) && !sameItem(item, updates.get(item.id)!));
  // Unchanged items, and the list itself when nothing differs, keep their identity, so a screen redraws only what changed.
  if (added.length || changed) {
    const kept = changed ? transcript.items.map((item) => {
      const update = updates.get(item.id);
      return update && !sameItem(item, update) ? update : item;
    }) : transcript.items;
    transcript.items = older ? [...added, ...kept] : [...kept, ...added];
  }
  transcript.branchId = page.branchId;
  if (older) return [];
  if (added.length && !transcript.following) transcript.newMessages = true;
  return added;
}
