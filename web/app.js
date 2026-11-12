// Phone inbox for pi-agent-hub. Producer text only ever reaches the page through text nodes.
import { acceptPage, clearChat, newChat, settleSent } from "/chat.js";
import { renderMarkdown } from "/markdown.js";

const STALE_MS = 10_000;
const DETAIL_POLL_MS = 1_500;
const FOLLOW_PX = 120;             // this close to the end, the view follows new messages
const TIME_GAP_MS = 5 * 60_000;    // a turn shows its time only after a pause this long
const WRITE_TIMEOUT_MS = 15_000;
const INLINE_CARD_LIMIT = 8;
const TIER_LABELS = { "needs-you": "NEEDS YOU", health: "HEALTH", new: "NEW", active: "ACTIVE", quiet: "QUIET" };
const STATUS_GLYPHS = { starting: "●", running: "●", waiting: "◐", idle: "○", error: "×", stopped: "-" };
const KIND_GLYPHS = { question: "?", ready: "✓", blocked: "!" };
const KIND_LABELS = { question: "Question", ready: "Ready", blocked: "Blocked" };
const STEP_GLYPHS = { done: "✓", active: "◉", pending: "·" };
const ROLE_LABELS = { user: "YOU", assistant: "AGENT", question: "? QUESTION", answer: "ANSWER" };
const SENT_LABELS = { sending: "Sending…", unknown: "Delivery unknown" };

const state = {
  snapshot: undefined,
  snapshotAt: 0,
  lastEventAt: 0,
  stale: true,
  collapsed: new Set(["quiet"]),
  detail: undefined,           // { id, data?, missing? }
  chat: undefined,             // transcript of the open session: { id, piSessionId, ...newChat() }
  sent: [],                    // replies shown before Pi records them: { localId, text, delivery, status }
  earlier: false,              // an earlier page is loading
  reveal: undefined,           // id of the first message the last poll added
  inline: new Map(),           // session id -> { requestId, question?, toolCallId?, selected? }
  forms: new Map(),            // "id:toolCallId" -> per-question { option, selected:Set, text, notes }
  drafts: new Map(),           // "id:piSessionId" -> reply text
  receipts: new Map(),         // session id -> { kind, text }
  pending: new Set(),          // session ids with a write in flight
};

const app = document.getElementById("app");

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** A key is a value, or a list of values compared one by one, so an object can be a key without being serialized. */
function sameKey(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, index) => value === b[index]) : a === b;
}

/** Rebuild a child only when its data changed, so typing, selection and focus survive live updates. */
function sync(root, parts) {
  const previous = root.hubParts ?? new Map();
  const next = new Map();
  const wanted = [];
  for (const [name, key, build] of parts) {
    if (!build) continue;
    const old = previous.get(name);
    const entry = old && sameKey(old.key, key) ? old : { key, el: build() };
    next.set(name, entry);
    wanted.push(entry.el);
  }
  wanted.forEach((el, index) => { if (root.children[index] !== el) root.insertBefore(el, root.children[index] ?? null); });
  while (root.children.length > wanted.length) root.lastChild.remove();
  root.hubParts = next;
}

const rows = () => state.snapshot?.tiers.flatMap((tier) => tier.sessions) ?? [];
const route = () => /^#\/s\/([a-zA-Z0-9_-]+)$/.exec(location.hash)?.[1];
const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const draftKey = (session) => `${session.id}:${session.piSessionId ?? ""}`;

function ageSince(at) {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  return minutes < 1 ? "under 1m ago" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

// ---- data ----

let events;
let connectedAt = 0;

/** iOS can leave a suspended page's stream open but silent, and EventSource only retries a closed one. */
function connect() {
  events?.close();
  connectedAt = Date.now();
  events = new EventSource("/api/events");
  events.addEventListener("snapshot", (event) => {
    state.snapshot = JSON.parse(event.data);
    state.snapshotAt = state.lastEventAt = Date.now();
    const wasStale = state.stale;
    state.stale = false;
    loadInlineQuestions();
    render();
    if (wasStale && route()) void loadDetail();
  });
  events.addEventListener("ping", () => { state.lastEventAt = Date.now(); });
}

function watchConnection() {
  const stale = Date.now() - state.lastEventAt > STALE_MS;
  if (stale !== state.stale || stale) { state.stale = stale; render(); }
  // Reopen a silent stream, at most once per stale interval.
  if (stale && Date.now() - connectedAt > STALE_MS) connect();
}

async function getJson(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(WRITE_TIMEOUT_MS) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.json();
}

/** One-question, single-choice requests can be answered on the list card. */
function loadInlineQuestions() {
  const cards = rows().filter((row) => row.attention?.kind === "question" && row.attention.requestId && row.canInteract).slice(0, INLINE_CARD_LIMIT);
  for (const [id, entry] of state.inline) {
    if (!cards.some((row) => row.id === id && row.attention.requestId === entry.requestId)) state.inline.delete(id);
  }
  for (const row of cards) {
    if (state.inline.has(row.id)) continue;
    const entry = { requestId: row.attention.requestId };
    state.inline.set(row.id, entry);
    getJson(`/api/sessions/${row.id}?conversation=0`).then((data) => {
      const pending = data.interaction?.pending ?? [];
      const question = pending.length === 1 && pending[0].questions.length === 1 ? pending[0].questions[0] : undefined;
      if (!data.interaction?.canAnswer || !question || question.multiSelect || question.options.some((option) => option.preview || option.hasPreview)) return;
      entry.question = question;
      entry.toolCallId = pending[0].toolCallId;
      render();
    }).catch(() => { state.inline.delete(row.id); });
  }
}

let detailToken = 0;
let detailLoading = false;
let detailAgain = false;

/** One read at a time. A call during a read discards that read's result and reads once more after it. */
async function loadDetail() {
  if (!route()) return;
  detailToken += 1;
  if (detailLoading) { detailAgain = true; return; }
  detailLoading = true;
  try {
    do {
      detailAgain = false;
      const id = route();
      if (!id) break;
      const token = detailToken;
      let data;
      let missing = false;
      try { data = await getJson(`/api/sessions/${id}`); }
      catch (error) { if (error.status !== 404) continue; missing = true; }
      if (token !== detailToken || route() !== id) continue;
      if (missing || !data.session) state.detail = { id, missing: true };
      else applyDetail(id, data);
      render();
    } while (detailAgain);
  } finally { detailLoading = false; }
}

function applyDetail(id, data) {
  state.detail = { id, data };
  const piSessionId = data.session.piSessionId;
  // Leaving the screen drops the transcript, so only a restarted session can differ here.
  if (!state.chat || state.chat.piSessionId !== piSessionId) {
    state.chat = { id, piSessionId, ...newChat() };
    state.sent = [];
  }
  if (!data.conversation) return;
  const chat = state.chat;
  const branchId = chat.branchId;
  const appended = acceptPage(chat, data.conversation);
  // A reply sent on a branch the session has left will not be recorded on this one.
  state.sent = branchId !== undefined && branchId !== chat.branchId ? [] : settleSent(state.sent, appended);
  // Not for a first or replaced page: those open at the end.
  if (appended.length && appended.length < chat.items.length) state.reveal = appended[0].id;
}

async function loadEarlier() {
  const chat = state.chat;
  if (!chat?.before || state.earlier) return;
  const { branchId, before } = chat;
  state.earlier = true;
  render();
  let page;
  let refused = false;
  try { page = await getJson(`/api/sessions/${chat.id}/conversation?before=${encodeURIComponent(before)}&branch=${encodeURIComponent(branchId)}`); }
  catch (error) { refused = error.status === 409; }
  state.earlier = false;
  // Apply only to the transcript and cursor the page was requested for.
  const current = state.chat === chat && chat.branchId === branchId && chat.before === before;
  if (current && refused) {
    // The cursor is no longer on the session's branch: start again from the newest page.
    clearChat(chat);
    void loadDetail();
  }
  // Keep the message that was first where it is on screen. Its element may be rebuilt, so it is found by id.
  const anchor = chat.items[0] && `t:${chat.items[0].id}`;
  const top = () => app.hubParts?.get("body")?.el.hubParts?.get(anchor)?.el.getBoundingClientRect().top;
  const was = top();
  if (current && page) acceptPage(chat, page, true);
  render();
  const now = top();
  if (current && page && was !== undefined && now !== undefined) window.scrollBy(0, now - was);
}

/** Every write shows a receipt and is sent once; a lost response is unknown, never retried. Returns the receipt kind. */
async function write(session, action, body) {
  if (state.pending.has(session.id) || state.stale) return undefined;
  state.pending.add(session.id);
  // A read that began before this write cannot show its effect.
  detailToken += 1;
  state.receipts.set(session.id, { kind: "submitting", text: "Submitting…" });
  render();
  let receipt;
  try {
    const response = await fetch(`/api/sessions/${session.id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) receipt = { kind: "accepted", text: `Accepted · ${clock()}` };
    else if (response.status === 504) receipt = { kind: "unknown", text: "Delivery unknown · Check Pi before retrying" };
    else receipt = { kind: "rejected", text: `Rejected · ${result.error ?? `HTTP ${response.status}`}` };
  } catch {
    receipt = { kind: "unknown", text: "Delivery unknown · Check Pi before retrying" };
  }
  state.pending.delete(session.id);
  state.receipts.set(session.id, receipt);
  render();
  if (route() === session.id) void loadDetail();
  return receipt.kind;
}

const target = (session) => ({ piSessionId: session.piSessionId, instanceId: session.instanceId });
const markRead = (session) => write(session, "read", { piSessionId: session.piSessionId, requestId: session.attention?.requestId });

// ---- shared pieces ----

function connection() {
  return h("span", { class: "conn" }, state.stale ? "◌ Offline" : "● Live");
}

function staleBanner() {
  if (!state.stale) return undefined;
  return h("div", { class: "stale", role: "status" }, state.snapshotAt ? `Reconnecting · data from ${ageSince(state.snapshotAt)}` : "Connecting…");
}

function receiptLine(sessionId) {
  const receipt = state.receipts.get(sessionId);
  return receipt && h("div", { class: `receipt ${receipt.kind}`, role: "status" }, receipt.text);
}

function meta(session) {
  const parts = [];
  if (session.step && !session.attention) parts.push(session.step);
  if (session.attention && session.group) parts.push(session.group);
  if (session.runningSubagents) parts.push(h("span", { class: "live" }, `↳${session.runningSubagents}`));
  if (session.hiddenChildRequests) parts.push(h("span", { class: "request" }, `?${session.hiddenChildRequests} child`));
  if (session.age) parts.push(session.age);
  return h("span", { class: "meta" }, parts.flatMap((part, index) => index ? [" · ", part] : [part]));
}

// ---- list ----

function listRow(session) {
  const attention = session.attention;
  const fault = session.status === "error";
  const live = session.status === "running" || session.status === "starting";
  const glyph = attention ? h("span", { class: "glyph request", title: KIND_LABELS[attention.kind] }, KIND_GLYPHS[attention.kind])
    : h("span", { class: `glyph${fault ? " fault" : live ? " live" : ""}`, title: session.status }, STATUS_GLYPHS[session.status]);
  const main = h("a", { class: "row-main", href: `#/s/${session.id}` },
    h("div", { class: "head" }, glyph, h("span", { class: "title" }, session.title), meta(session)),
    attention && h("p", { class: "request-text clamp" }, attention.text),
    attention?.recommendation && h("p", { class: "sub" }, `Recommends: ${attention.recommendation}`),
    !attention && session.statusLine && h("p", { class: `sub${fault ? " fault" : ""}` }, session.statusLine));
  if (!attention && !fault) return h("li", { class: "row" }, main);
  return h("li", { class: `row plate${fault && !attention ? " fault" : ""}` }, main, inlineActions(session), receiptLine(session.id));
}

function inlineActions(session) {
  const entry = state.inline.get(session.id);
  if (!entry?.question || entry.requestId !== session.attention?.requestId) return undefined;
  const busy = state.pending.has(session.id) || state.stale;
  const options = entry.question.options.map((option, index) => h("button", {
    class: "btn", type: "button", "aria-pressed": String(entry.selected === index), disabled: busy,
    onclick: () => { entry.selected = entry.selected === index ? undefined : index; render(); },
  }, option.label));
  if (entry.selected === undefined) return h("div", { class: "actions" }, options);
  const chosen = entry.question.options[entry.selected];
  // A tap only selects: answers cannot be undone, so sending is a second, explicit tap.
  return h("div", { class: "actions" }, options,
    h("button", { class: "btn primary", type: "button", disabled: busy, onclick: async () => {
      const optionIndex = entry.selected;
      const sent = await write(session, "answer", { ...target(session), toolCallId: entry.toolCallId, requestId: entry.requestId, answers: [{ questionIndex: 0, kind: "option", optionIndex }] });
      if (sent === "accepted") state.inline.delete(session.id); else { entry.selected = undefined; render(); }
    } }, `Send “${chosen.label}”`),
    h("button", { class: "btn quiet", type: "button", disabled: busy, onclick: () => { entry.selected = undefined; render(); } }, "Cancel"));
}

function listView() {
  const snapshot = state.snapshot;
  const count = snapshot?.requestCount ?? 0;
  const band = h("header", { class: "band" },
    h("div", { class: "band-row" },
      h("h1", { class: "band-title" }, "Hub"),
      count ? h("span", { class: "band-count" }, `${count} ${count === 1 ? "request" : "requests"}`) : undefined,
      h("span", { class: "band-fill" }),
      connection(),
      h("button", { class: "link-btn", type: "button", onclick: openSettings }, "Notify")),
    staleBanner());
  const list = h("main", { class: "list" });
  if (!snapshot) list.append(h("p", { class: "empty" }, "Loading sessions…"));
  else if (!snapshot.tiers.length) list.append(h("p", { class: "empty" }, "No active sessions."));
  for (const tier of snapshot?.tiers ?? []) {
    const collapsible = tier.tier !== "needs-you" && tier.tier !== "new";
    const collapsed = collapsible && state.collapsed.has(tier.tier);
    const label = [TIER_LABELS[tier.tier], h("span", { class: "tier-count" }, `· ${tier.sessions.length}`)];
    list.append(collapsible
      ? h("button", { class: "tier-head", type: "button", "aria-expanded": String(!collapsed), onclick: () => {
          if (collapsed) state.collapsed.delete(tier.tier); else state.collapsed.add(tier.tier);
          render();
        } }, label, h("span", { class: "tier-toggle" }, collapsed ? "▸" : "▾"))
      : h("h2", { class: "tier-head" }, label));
    if (!collapsed) list.append(h("ul", {}, tier.sessions.map(listRow)));
  }
  return [band, list];
}

// ---- detail ----

function formFor(session, request) {
  const key = `${session.id}:${request.toolCallId}`;
  if (!state.forms.has(key)) state.forms.set(key, request.questions.map(() => ({ option: undefined, selected: new Set(), text: "", notes: "" })));
  return state.forms.get(key);
}

function answersFor(request, form) {
  const answers = [];
  for (const [questionIndex, question] of request.questions.entries()) {
    const entry = form[questionIndex];
    const text = entry.text.trim();
    let answer;
    if (text) answer = { questionIndex, kind: "custom", text };
    else if (question.multiSelect && entry.selected.size) answer = { questionIndex, kind: "multi", optionIndices: [...entry.selected].sort((a, b) => a - b) };
    else if (!question.multiSelect && entry.option !== undefined) answer = { questionIndex, kind: "option", optionIndex: entry.option };
    if (!answer) return undefined;
    if (entry.notes.trim()) answer.notes = entry.notes;
    answers.push(answer);
  }
  return answers;
}

function questionForm(session, request) {
  const form = formFor(session, request);
  return h("div", {}, request.questions.map((question, questionIndex) => {
    const entry = form[questionIndex];
    const name = `q-${request.toolCallId}-${questionIndex}`;
    const inputs = [];
    const typed = h("input", { class: "field", type: "text", value: entry.text, placeholder: "Or type an answer", "aria-label": "Type an answer", enterKeyHint: "done",
      oninput: (event) => {
        entry.text = event.target.value;
        // A typed answer replaces the options, so the form never shows two answers at once.
        if (entry.text.trim()) { entry.option = undefined; entry.selected.clear(); for (const input of inputs) input.checked = false; }
        render();
      } });
    const options = question.options.map((option, optionIndex) => {
      const input = h("input", { type: question.multiSelect ? "checkbox" : "radio", name,
        checked: question.multiSelect ? entry.selected.has(optionIndex) : entry.option === optionIndex,
        onchange: (event) => {
          if (question.multiSelect) { if (event.target.checked) entry.selected.add(optionIndex); else entry.selected.delete(optionIndex); }
          else entry.option = optionIndex;
          entry.text = ""; typed.value = "";
          render();
        } });
      inputs.push(input);
      return h("label", { class: "option" }, input, h("span", {},
        h("span", { class: "option-label" }, option.label),
        option.description && h("div", { class: "option-desc" }, option.description),
        option.preview && h("pre", { class: "preview" }, option.preview)));
    });
    return h("section", { class: "question" },
      h("div", { class: "label" }, request.questions.length > 1 ? `${question.header} — ${questionIndex + 1} of ${request.questions.length}` : question.header),
      h("p", { class: "ask pre" }, question.ask),
      question.conditions.length ? h("ul", { class: "conditions" }, question.conditions.map((condition) => h("li", {}, condition))) : undefined,
      question.context && h("p", { class: "notice pre" }, question.context),
      question.multiSelect && h("div", { class: "label" }, "Choose any"),
      options, typed,
      h("details", { open: Boolean(entry.notes) }, h("summary", {}, "Add a note"),
        h("input", { class: "field", type: "text", value: entry.notes, maxLength: 8192, placeholder: "Note for the agent", "aria-label": "Note",
          oninput: (event) => { entry.notes = event.target.value; } })));
  }));
}

function requestBlock(session, interaction) {
  const attention = session.attention;
  const pending = interaction?.pending ?? [];
  if (!attention && !pending.length && session.status !== "error") return undefined;
  const parts = [];
  if (attention) {
    parts.push(["head", attention.kind, () => h("div", { class: "block-head" }, h("span", { class: "glyph request" }, KIND_GLYPHS[attention.kind]), KIND_LABELS[attention.kind])]);
    if (!pending.length || !interaction?.canAnswer) parts.push(["text", attention.text, () => h("p", { class: "pre" }, attention.text)]);
    if (attention.recommendation) parts.push(["recommendation", attention.recommendation, () => h("div", {},
      h("div", { class: "label" }, "Recommends"), h("p", { class: "pre" }, attention.recommendation),
      session.canInteract && h("button", { class: "btn quiet", type: "button", onclick: () => {
        // Prefill only: nothing is sent until Send.
        state.drafts.set(draftKey(session), attention.recommendation);
        const box = document.querySelector(".dock textarea");
        if (box) { box.value = attention.recommendation; fitComposer(box); box.focus(); }
      } }, "Use as reply"))]);
    if (attention.artifact) parts.push(["artifact", attention.artifact, () => h("div", {}, h("div", { class: "label" }, "Evidence"), h("p", { class: "path" }, attention.artifact))]);
  } else if (session.status === "error") {
    parts.push(["fault", session.statusLine, () => h("div", {}, h("div", { class: "block-head" }, h("span", { class: "glyph fault" }, "×"), "Fault"), h("p", { class: "pre" }, session.statusLine ?? "Session reported an error"))]);
  }
  if (pending.length && interaction.canAnswer) {
    for (const request of pending) {
      parts.push([`form:${request.toolCallId}`, JSON.stringify(request), () => questionForm(session, request)]);
      const answers = answersFor(request, formFor(session, request));
      const blocked = state.pending.has(session.id) || state.stale;
      parts.push([`submit:${request.toolCallId}`, `${Boolean(answers)}:${blocked}`, () => h("button", { class: "btn primary", type: "button", disabled: !answers || blocked,
        onclick: async () => {
          const current = answersFor(request, formFor(session, request));
          if (!current) return;
          const sent = await write(session, "answer", { ...target(session), toolCallId: request.toolCallId, requestId: attention?.requestId, answers: current });
          if (sent === "accepted") state.forms.delete(`${session.id}:${request.toolCallId}`);
        } }, answers ? "Send answer" : "Answer every question to send")]);
    }
  } else if (pending.length) {
    parts.push(["unavailable", interaction.answerUnavailable, () => h("p", { class: "notice" }, `${interaction.answerUnavailable ?? "Direct answering unavailable"}. Open this session in Pi to answer.`)]);
  }
  return { tone: !attention && session.status === "error" ? "fault" : "request", parts };
}

let localId = 0;

/** The reply box is one line and grows with its text, up to the limit set in the stylesheet. */
function fitComposer(box) {
  if (!box) return;
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  // The dock grew or shrank under a reader who is at the end.
  if (state.chat?.following) scrollToEnd();
}

function composer(session, interaction) {
  const busy = interaction?.messageDelivery === "busy";
  const blocked = state.pending.has(session.id) || state.stale;
  const key = draftKey(session);
  const box = h("textarea", { class: "field grow", rows: 1, "data-draft": key, placeholder: busy ? "Message a working agent" : "Reply", "aria-label": "Reply", value: state.drafts.get(key) ?? "",
    oninput: (event) => { state.drafts.set(key, event.target.value); fitComposer(event.target); } });
  const send = (delivery) => async () => {
    const text = box.value.trim();
    if (!text) { box.focus(); return; }
    if (state.pending.has(session.id) || state.stale) return;
    // Pi runs a slash command instead of recording it as typed, so only the receipt reports it.
    const reply = delivery === "send" && text.startsWith("/") ? undefined : { localId: localId += 1, text, delivery, status: "sending" };
    if (reply && state.chat?.id === session.id) {
      state.sent = [...state.sent, reply];
      state.chat.following = true;
    }
    const result = await write(session, "reply", { ...target(session), text, delivery });
    if (reply) {
      state.sent = result === "accepted" || result === "unknown"
        ? state.sent.map((entry) => entry.localId === reply.localId ? { ...entry, status: result } : entry)
        : state.sent.filter((entry) => entry.localId !== reply.localId);
      render();
    }
    if (result !== "accepted") return;
    // Keep anything typed while the reply was in flight.
    if ((state.drafts.get(key) ?? "").trim() !== text) return;
    state.drafts.delete(key);
    const shown = document.querySelector(`.dock textarea[data-draft="${CSS.escape(key)}"]`);
    if (shown) { shown.value = ""; fitComposer(shown); }
  };
  const canRead = Boolean(session.attention) || session.status === "waiting";
  return h("div", { class: "composer" },
    box,
    h("div", { class: "dock-row" },
      canRead && h("button", { class: "btn quiet", type: "button", disabled: blocked, onclick: () => markRead(session) }, "Mark read"),
      h("span", { class: "grow" }),
      busy
        ? [h("button", { class: "btn", type: "button", disabled: blocked, onclick: send("followUp") }, "Queue"),
           h("button", { class: "btn primary", type: "button", disabled: blocked, onclick: send("steer") }, "Steer")]
        : h("button", { class: "btn primary", type: "button", disabled: blocked, onclick: send("send") }, "Send")));
}

// ---- transcript ----

function timeLabel(at) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** One message. Only the agent writes Markdown; what a person typed is shown as typed. */
function turn(item, time) {
  // A kind this page does not know yet is still shown, as plain text under its own name.
  const role = String(item.role);
  return h("article", { class: `turn is-${role.replace(/[^a-z0-9]/giu, "")}` },
    h("div", { class: "turn-role" }, h("span", {}, ROLE_LABELS[role] ?? role.toUpperCase()), time && h("time", {}, time)),
    role === "assistant" ? h("div", { class: "turn-body md" }, renderMarkdown(item.text, h)) : h("div", { class: "turn-body pre" }, item.text));
}

/** A reply the user sent that Pi has not recorded yet. */
function localTurn(reply) {
  const status = SENT_LABELS[reply.status] ?? (reply.delivery === "followUp" ? "Queued" : "Sent");
  return h("article", { class: `turn is-user local ${reply.status}` },
    h("div", { class: "turn-role" }, h("span", {}, ROLE_LABELS.user), h("span", { class: "turn-state" }, status)),
    h("div", { class: "turn-body pre" }, reply.text));
}

const fromEnd = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
const scrollToEnd = () => window.scrollTo(0, document.documentElement.scrollHeight);

let shownHeight = 0;
/** After a render: a reader at the end sees new content from its first line. */
function followTranscript(body) {
  const chat = state.chat;
  const reveal = state.reveal;
  state.reveal = undefined;
  const height = document.documentElement.scrollHeight;
  if (height === shownHeight) return;
  shownHeight = height;
  if (!chat?.following) return;
  const first = reveal && body.hubParts.get(`t:${reveal}`)?.el;
  if (!first) { scrollToEnd(); return; }
  // A message taller than the screen starts under the band; a short one ends the page.
  const band = app.querySelector(".band").getBoundingClientRect().bottom;
  window.scrollTo(0, Math.min(first.getBoundingClientRect().top + window.scrollY - band, height - window.innerHeight));
}

function goToEnd() {
  const chat = state.chat;
  if (!chat) return;
  chat.following = true;
  chat.fresh = false;
  render();
  scrollToEnd();
  // More than a page may have arrived while the reader was away from the end.
  void loadDetail();
}

function renderDetail() {
  const detail = state.detail;
  // The list snapshot is fresher than the last detail fetch for everything it carries.
  const session = detail?.data && (rows().find((row) => row.id === detail.id) ?? detail.data.session);
  const band = ["band", JSON.stringify([state.stale, state.stale ? ageSince(state.snapshotAt) : "", session?.title, session?.steps]), () => h("header", { class: "band" },
    h("div", { class: "band-row" }, h("a", { class: "back", href: "#/" }, "‹ Inbox"),
      session ? h("span", { class: "band-name" }, session.title) : h("span", { class: "band-fill" }), connection()),
    session?.steps && h("div", { class: "lcd" }, session.steps.map((step) => `${step.short} ${STEP_GLYPHS[step.state]}`).join("  ")),
    staleBanner())];
  if (!session) {
    sync(app, [band, ["empty", String(detail?.missing), () => h("main", { class: "detail" },
      h("p", { class: "empty" }, detail?.missing ? "This session is no longer in the inbox." : "Loading…"))]]);
    return;
  }
  sync(app, [band, ["body", "body", () => h("main", { class: "detail transcript" })], ["dock", "dock", () => h("footer", { class: "dock" })]]);
  const body = app.hubParts.get("body").el;
  const dock = app.hubParts.get("dock").el;
  const { interaction, unavailable } = detail.data;
  const chat = state.chat?.id === detail.id ? state.chat : undefined;
  const request = requestBlock(session, interaction);

  // A question that can be answered here is shown once, as the form.
  const answering = new Set(interaction?.canAnswer ? interaction.pending.map((pending) => pending.toolCallId) : []);
  let lastAt;
  const turns = (chat?.items ?? []).filter((item) => item.role !== "question" || !answering.has(item.toolCallId)).map((item) => {
    const time = item.at !== undefined && (lastAt === undefined || item.at - lastAt >= TIME_GAP_MS) ? timeLabel(item.at) : "";
    if (item.at !== undefined) lastAt = item.at;
    return [`t:${item.id}`, [item, time], () => turn(item, time)];
  });
  const working = session.status === "running" || session.status === "starting";
  sync(body, [
    ["intro", JSON.stringify([session.title, session.ticketId, session.subtitle, session.group]), () => h("div", { class: "intro" },
      h("h1", { class: "detail-title" }, session.title),
      h("p", { class: "detail-sub" }, [session.ticketId, session.subtitle, session.group].filter(Boolean).join(" · ")))],
    chat?.before && !unavailable
      ? ["earlier", String(state.earlier), () => h("button", { class: "earlier", type: "button", disabled: state.earlier, onclick: loadEarlier }, "Earlier messages")]
      : ["start", `${Boolean(chat?.before)}:${turns.length}`, !chat?.before && turns.length && (() => h("p", { class: "start" }, "Start of conversation"))],
    ...turns,
    ...(chat ? state.sent : []).map((reply) => [`l:${reply.localId}`, reply.status, () => localTurn(reply)]),
    ["activity", working && (session.statusLine ?? ""), working && (() => h("p", { class: "activity", role: "status" },
      h("span", { class: "activity-dot" }, "●"), session.statusLine ?? "Working"))],
    ["request", request ? request.tone : "", request && (() => h("section", { class: `block ${request.tone}` }))],
  ]);
  if (request) sync(body.hubParts.get("request").el, request.parts);
  const canRead = Boolean(session.attention) || session.status === "waiting";
  // Mark read binds the conversation and request it shows, so a new request must rebuild the button.
  const readKey = canRead ? `${session.piSessionId}:${session.attention?.requestId ?? ""}` : "";
  const blocked = state.pending.has(session.id) || state.stale;
  const receipt = state.receipts.get(session.id);
  // The composer is rebuilt when its buttons change; the draft is in state, so only focus needs restoring.
  const typing = document.activeElement?.matches?.(".dock textarea");
  sync(dock, [
    ["pill", "pill", chat?.fresh && (() => h("button", { class: "pill", type: "button", onclick: goToEnd }, "New messages ↓"))],
    ["receipt", JSON.stringify(receipt ?? null), receipt && (() => receiptLine(session.id))],
    session.canInteract && !unavailable
      ? ["composer", `${draftKey(session)}:${session.instanceId}:${interaction?.messageDelivery}:${blocked}:${readKey}`, () => composer(session, interaction)]
      : ["closed", `${unavailable}:${blocked}:${readKey}`, () => h("div", {},
          h("p", { class: "notice" }, `${unavailable ?? "Session is not running"}. Open it in the terminal dashboard.`),
          canRead && h("div", { class: "dock-row" }, h("button", { class: "btn quiet", type: "button", disabled: blocked, onclick: () => markRead(session) }, "Mark read")))],
  ]);
  const box = dock.querySelector("textarea");
  if (box && !box.style.height) fitComposer(box);
  if (typing) box?.focus();
  followTranscript(body);
}

// ---- render ----

let shownRoute;
function render() {
  const id = route();
  if (id !== shownRoute) {
    shownRoute = id;
    app.hubParts = undefined;
    app.replaceChildren();
    shownHeight = 0;
    window.scrollTo(0, 0);
  }
  const count = state.snapshot?.requestCount ?? 0;
  document.title = count ? `(${count}) Hub` : "Hub";
  if (id) renderDetail();
  else {
    const [band, list] = listView();
    // The list has no text inputs, so it is rebuilt whole.
    app.hubParts = undefined;
    app.replaceChildren(band, list);
  }
}

function onRoute() {
  const id = route();
  state.detail = id ? { id } : undefined;
  // The transcript and unrecorded replies belong to the screen that was left.
  state.chat = undefined;
  state.sent = [];
  state.earlier = false;
  render();
  if (id) void loadDetail();
}

// ---- notifications ----

const settings = document.getElementById("settings");

function keyBytes(base64url) {
  const text = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

async function pushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription();
}

async function post(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
}

async function enablePush() {
  // iOS only accepts the permission request directly inside the tap, so it comes before any other await.
  if (await Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked for Hub in this device's settings");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { key } = await getJson("/api/push/key");
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await post("/api/push/subscribe", subscription.toJSON());
}

async function disablePush() {
  const subscription = await pushSubscription();
  if (!subscription) return;
  await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

async function renderSettings(message) {
  const close = h("button", { class: "btn quiet", type: "button", onclick: () => settings.close() }, "Close");
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const sheet = h("div", { class: "sheet" }, h("h2", {}, "Notify this device"));
  if (!supported) {
    // iOS only offers Web Push to a site that was added to the Home Screen.
    const ios = "standalone" in navigator && !navigator.standalone;
    sheet.append(ios
      ? h("div", {}, h("p", {}, "Add Hub to your Home Screen first, then open it from there."),
          h("ol", { class: "steps" }, h("li", {}, "Tap the Share button in Safari."), h("li", {}, "Choose Add to Home Screen."), h("li", {}, "Open Hub from the Home Screen and come back here.")))
      : h("p", { class: "notice" }, "This browser cannot receive notifications from Hub."));
  } else {
    const on = Boolean(await pushSubscription());
    sheet.append(
      h("p", { class: "notice" }, on ? "This device gets a notification when an agent asks, hands off or is blocked." : "Get a notification when an agent asks, hands off or is blocked."),
      h("button", { class: `btn${on ? "" : " primary"}`, type: "button", onclick: async (event) => {
        event.target.disabled = true;
        try { await (on ? disablePush() : enablePush()); await renderSettings(); }
        catch (error) { await renderSettings(error.message); }
      } }, on ? "Turn off notifications" : "Turn on notifications"));
  }
  if (message) sheet.append(h("p", { class: "receipt rejected", role: "status" }, message));
  sheet.append(close);
  settings.replaceChildren(sheet);
}

async function openSettings() {
  await renderSettings();
  settings.showModal();
}

navigator.serviceWorker?.addEventListener("message", (event) => {
  if (typeof event.data?.url === "string" && event.data.url.startsWith("/#/")) location.hash = event.data.url.slice(2);
});

window.addEventListener("hashchange", onRoute);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  // Returning to the app: do not wait for the stale timer to notice a stream that died in the background.
  if (Date.now() - state.lastEventAt > STALE_MS / 2) connect();
  if (route()) void loadDetail();
});
setInterval(watchConnection, 1_000);
window.addEventListener("scroll", () => {
  const chat = state.chat;
  if (!chat || !route()) return;
  const following = fromEnd() <= FOLLOW_PX;
  if (following === chat.following) return;
  chat.following = following;
  // The reader came back to the end by hand.
  if (following && chat.fresh) goToEnd();
}, { passive: true });
setInterval(() => { if (route() && !document.hidden && !state.stale && !state.pending.size && !detailLoading) void loadDetail(); }, DETAIL_POLL_MS);
connect();
onRoute();
