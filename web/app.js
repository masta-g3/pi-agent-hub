// Phone inbox for pi-agent-hub. Producer text only ever reaches the page through text nodes.
import { acceptPage, clearTranscript, newTranscript } from "/transcript.js";
import { settleSent, splitPrompt } from "/chat.js";
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
const STATUS_WORDS = { starting: "Starting", running: "Working", waiting: "Waiting", idle: "Idle", error: "Error", stopped: "Stopped" };
// You and the agent are told apart by layout; other kinds keep a visible name.
const ROLE_LABELS = { user: "You", assistant: "Agent", question: "Question", answer: "Your answer" };
const QUIET_ROLES = new Set(["user", "assistant"]);
const SENT_LABELS = { sending: "Sending…", unknown: "Delivery unknown" };

const state = {
  snapshot: undefined,
  snapshotAt: 0,
  lastEventAt: 0,
  stale: true,
  collapsed: new Set(["quiet"]),
  detail: undefined,           // { id, data?, missing? }
  chat: undefined,             // transcript of the open session: { id, piSessionId, ...newTranscript() }
  sent: [],                    // replies shown before Pi records them: { localId, text, delivery, status }
  earlier: false,              // an earlier page is loading
  reveal: undefined,           // id of the first message the last poll added
  inline: new Map(),           // session id -> { requestId, question?, toolCallId?, selected? }
  forms: new Map(),            // "id:toolCallId" -> per-question { option, selected:Set, text, notes }
  drafts: new Map(),           // "id:piSessionId" -> reply text
  receipts: new Map(),         // session id -> { kind, text }
  pending: new Set(),          // session ids with a write in flight
  listY: 0,                    // list scroll position, restored on return
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

/** How long the agent has been working: 45s, 2m, 1h 5m. */
function runTime(since) {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

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

/** A question request can be answered on its list card, one question at a time. */
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
      // Send also dismisses the card's request, so the card answers only when that request is the one questionnaire.
      if (!data.interaction?.canAnswer || pending.length !== 1) return;
      entry.request = pending[0];
      entry.step = 0;
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
    state.chat = { id, piSessionId, ...newTranscript() };
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
    clearTranscript(chat);
    void loadDetail();
  }
  // Keep the message that was first where it is on screen. Its element may be rebuilt, so it is found by id.
  const anchor = chat.items[0] && `t:${chat.items[0].id}`;
  // Its body, not the turn: the time stamp above it can come or go as earlier messages arrive.
  const top = () => app.hubParts?.get("body")?.el.hubParts?.get(anchor)?.el.querySelector(".turn-body")?.getBoundingClientRect().top;
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

function connection(compact) {
  const label = state.stale ? "Offline" : "Live";
  return h("span", { class: `conn ${state.stale ? "off" : "on"}`, title: label, role: "status", "aria-label": label },
    h("span", { class: "conn-dot", "aria-hidden": "true" }, "●"), !compact && label);
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
  const main = h("a", { class: "row-main", href: `#/s/${session.id}`, onclick: openFromList },
    h("div", { class: "head" }, glyph, h("span", { class: "title" }, session.title), meta(session)),
    // The stepper asks the question itself, so the card does not repeat it.
    attention && !(state.inline.get(session.id)?.request && state.inline.get(session.id).requestId === attention.requestId) && h("p", { class: "request-text clamp" }, attention.text),
    attention?.recommendation && h("p", { class: "sub" }, `Recommends: ${attention.recommendation}`),
    // A working agent shows what it does now; an older note would read as current.
    !attention && session.work ? h("p", { class: `sub one-line${session.work.tool ? "" : " thinking"}` }, session.work.tool ?? "Thinking")
      : !attention && session.statusLine && h("p", { class: `sub one-line${fault ? " fault" : ""}` }, session.statusLine));
  if (!attention && !fault) return h("li", { class: "row" }, main);
  return h("li", { class: `row plate${fault && !attention ? " fault" : ""}` }, main, inlineActions(session), receiptLine(session.id));
}

const answered = (question, entry) => Boolean(entry.text.trim()) || (question.multiSelect ? entry.selected.size > 0 : entry.option !== undefined);

/**
 * The list card's answer stepper: one question at a time, dots for progress. A single choice moves on by itself;
 * nothing is sent until Send, after the last question. Answers live in the same form as the chat's.
 */
function inlineActions(session) {
  const inline = state.inline.get(session.id);
  const request = inline?.request;
  if (!request || inline.requestId !== session.attention?.requestId) return undefined;
  const form = formFor(session, request);
  const count = request.questions.length;
  const step = Math.min(inline.step, count - 1);
  const question = request.questions[step];
  const entry = form[step];
  const busy = state.pending.has(session.id) || state.stale;
  const last = step === count - 1;
  const go = (to) => { inline.step = to; render(); };
  const next = () => go(last ? step : step + 1);

  const dots = count > 1 && h("span", { class: "dots-nav" }, request.questions.map((item, index) => h("button", {
    type: "button", class: "dot-btn", "aria-label": `Question ${index + 1}${answered(item, form[index]) ? ", answered" : ""}`,
    "aria-current": index === step ? "step" : undefined, onclick: () => go(index),
  }, index === step ? "●" : answered(item, form[index]) ? "✓" : "○")));
  const options = question.options.map((option, index) => {
    const on = question.multiSelect ? entry.selected.has(index) : entry.option === index;
    return h("button", { class: "opt", type: "button", "aria-pressed": String(on), disabled: busy, onclick: () => {
      entry.text = "";
      if (question.multiSelect) { if (on) entry.selected.delete(index); else entry.selected.add(index); render(); return; }
      entry.option = index;
      if (last) render(); else next();
    } }, h("span", { class: "opt-label" }, option.label), option.description && h("span", { class: "opt-desc" }, option.description));
  });
  const typed = h("input", { class: "field", type: "text", autocomplete: "off", value: entry.text, placeholder: "Type an answer", "aria-label": "Type an answer",
    "data-focus": `typed:${session.id}:${step}`, enterKeyHint: last ? "done" : "next", disabled: busy,
    oninput: (event) => {
      entry.text = event.target.value;
      if (entry.text.trim()) { entry.option = undefined; entry.selected.clear(); }
      render();
    },
    onkeydown: (event) => { if (event.key === "Enter" && entry.text.trim()) { event.preventDefault(); if (!last) next(); } } });
  const answers = answersFor(request, form);
  const sendLabel = count === 1 ? "Send answer" : `Send ${count} answers`;
  return h("div", { class: "stepper" },
    h("div", { class: "step-head" },
      h("span", { class: "label" }, count > 1 ? `${question.header} · ${step + 1} of ${count}` : question.header), dots),
    h("p", { class: "ask pre" }, question.ask),
    question.conditions.length ? h("ul", { class: "conditions" }, question.conditions.map((condition) => h("li", {}, condition))) : undefined,
    question.context && h("p", { class: "notice pre" }, question.context),
    question.multiSelect && h("div", { class: "opt-hint" }, "Choose any"),
    h("div", { class: "opts" }, options),
    question.options.some((option) => option.preview || option.hasPreview) && h("a", { class: "opt-more", href: `#/s/${session.id}`, onclick: openFromList }, "See previews in chat ›"),
    typed,
    h("div", { class: "step-foot" },
      step > 0 ? h("button", { class: "link-btn", type: "button", onclick: () => go(step - 1) }, "‹ Back") : undefined,
      h("span", { class: "grow" }),
      last
        // Answers cannot be undone, so sending is always its own tap.
        ? h("button", { class: "send", type: "button", disabled: busy || !answers, onclick: async () => {
            const current = answersFor(request, formFor(session, request));
            if (!current) return;
            const sent = await write(session, "answer", { ...target(session), toolCallId: request.toolCallId, requestId: inline.requestId, answers: current });
            if (sent === "accepted") { state.inline.delete(session.id); state.forms.delete(`${session.id}:${request.toolCallId}`); }
          } }, answers ? sendLabel : "Answer each question")
        : h("button", { class: "send ghost", type: "button", disabled: busy || !answered(question, entry), onclick: next }, "Next")));
}

function listView() {
  const snapshot = state.snapshot;
  const count = snapshot?.requestCount ?? 0;
  const band = h("header", { class: "band" },
    h("div", { class: "band-row" },
      h("h1", { class: "band-title" }, "Hub"),
      count ? h("span", { class: "band-count" }, `${count} ${count === 1 ? "request" : "requests"}`) : undefined,
      h("span", { class: "band-fill" }),
      connection(false),
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
    const typed = h("input", { class: "field", type: "text", autocomplete: "off", value: entry.text, placeholder: "Or type an answer", "aria-label": "Type an answer", enterKeyHint: "done",
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
        h("input", { class: "field", type: "text", autocomplete: "off", value: entry.notes, maxLength: 8192, placeholder: "Note for the agent", "aria-label": "Note",
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
      session.canInteract && h("button", { class: "chip", type: "button", onclick: () => {
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
  // Messages, not a form: without this, iOS offers saved contact details such as a phone number.
  const box = h("textarea", { class: "field grow", rows: 1, autocomplete: "off", "data-draft": key, placeholder: busy ? "Message" : "Reply", "aria-label": "Reply", value: state.drafts.get(key) ?? "",
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
  // One row, as in a messenger: the box grows upward, the buttons stay at its foot.
  return h("div", { class: "composer" },
    box,
    busy
      ? [h("button", { class: "send ghost", type: "button", disabled: blocked, title: "Deliver after the agent finishes", onclick: send("followUp") }, "Queue"),
         h("button", { class: "send", type: "button", disabled: blocked, title: "Deliver now, while it works", onclick: send("steer") }, "Steer")]
      : h("button", { class: "send", type: "button", disabled: blocked, onclick: send("send") }, "Send"));
}

function readChip(session, blocked) {
  return h("button", { class: "chip", type: "button", disabled: blocked, onclick: () => markRead(session) }, "Mark read");
}

// ---- transcript ----

function timeLabel(at) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** What Pi expanded into a message, folded to its name: open it to read the skill or file. */
function attachment(part) {
  return h("details", { class: "attach" },
    h("summary", {}, h("span", { class: "attach-kind" }, part.kind === "skill" ? "/" : "@"), part.name),
    part.body && h("pre", { class: "attach-body" }, part.body));
}

/** One message. Only the agent writes Markdown; what a person typed is shown as typed, minus Pi's expansions. */
function turn(item, time) {
  // A kind this page does not know yet is still shown, as plain text under its own name.
  const role = String(item.role);
  const label = ROLE_LABELS[role] ?? role.toUpperCase();
  let body;
  // A question in history is the agent's own words and option list, so it reads as Markdown too.
  if (role === "assistant" || role === "question") body = h("div", { class: "turn-body md" }, renderMarkdown(item.text, h));
  else if (role === "user") {
    const { attachments, text } = splitPrompt(item.text);
    // Only an invocation, no typed words: the chip stands alone, without a bubble around it.
    body = h("div", { class: text ? "turn-body" : "turn-body bare" }, attachments.map(attachment), text && h("div", { class: "pre" }, text));
  } else body = h("div", { class: "turn-body pre" }, item.text);
  // Said on the way to a tool call: quieter than the reply that ends the turn.
  return h("article", { class: `turn is-${role.replace(/[^a-z0-9]/giu, "")}${item.interim ? " interim" : ""}` },
    time && h("time", { class: "stamp" }, time),
    h("div", { class: QUIET_ROLES.has(role) ? "turn-role sr" : "turn-role" }, label),
    body);
}

/** A reply the user sent that Pi has not recorded yet. */
function localTurn(reply) {
  const status = SENT_LABELS[reply.status] ?? (reply.delivery === "followUp" ? "Queued" : "Sent");
  return h("article", { class: `turn is-user local ${reply.status}` },
    h("div", { class: "turn-role sr" }, ROLE_LABELS.user),
    h("div", { class: "turn-body pre" }, reply.text),
    h("div", { class: "turn-state" }, status));
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
  chat.newMessages = false;
  render();
  scrollToEnd();
  // More than a page may have arrived while the reader was away from the end.
  void loadDetail();
}

/** The header's second line: what the agent is doing and where its workflow is. */
function statusLine(session) {
  const parts = [h("span", { class: `state is-${session.attention ? "request" : session.status}` },
    session.attention ? KIND_LABELS[session.attention.kind] : STATUS_WORDS[session.status] ?? session.status)];
  const at = session.steps?.findIndex((step) => step.state === "active") ?? -1;
  if (session.step) parts.push(at >= 0 ? `${session.step} ${at + 1}/${session.steps.length}` : session.step);
  if (session.runningSubagents) parts.push(`↳${session.runningSubagents}`);
  return h("div", { class: "band-sub" }, parts.flatMap((part, index) => index ? [" · ", part] : [part]));
}

function backLink() {
  return h("a", { class: "back", href: "#/", "aria-label": "Back to inbox", onclick: (event) => {
    // Opened from the list: step back, so the list returns where it was and Back does not loop.
    if (!history.state?.fromList) return;
    event.preventDefault();
    history.back();
  } }, "‹");
}

function renderDetail() {
  const detail = state.detail;
  // The list snapshot is fresher than the last detail fetch for everything it carries.
  const session = detail?.data && (rows().find((row) => row.id === detail.id) ?? detail.data.session);
  const head = session && [session.title, session.status, session.attention?.kind, session.step, session.steps, session.runningSubagents];
  const band = ["band", JSON.stringify([state.stale, state.stale ? ageSince(state.snapshotAt) : "", head]), () => h("header", { class: "band chat-band" },
    h("div", { class: "band-row" }, backLink(),
      session ? h("div", { class: "band-id" }, h("span", { class: "band-name", title: session.title }, session.title), statusLine(session)) : h("span", { class: "band-fill" }),
      connection(true)),
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
  const work = session.work ?? {};
  const context = [session.ticketId, session.subtitle, session.group].filter(Boolean).join(" · ");
  sync(body, [
    // The band names the session; this line adds the ticket, like a chat's info line.
    ["intro", context, context && (() => h("p", { class: "intro" }, context))],
    chat?.before && !unavailable
      ? ["earlier", String(state.earlier), () => h("button", { class: "earlier", type: "button", disabled: state.earlier, onclick: loadEarlier }, "Earlier messages")]
      : ["start", `${Boolean(chat?.before)}:${turns.length}`, !chat?.before && turns.length && (() => h("p", { class: "start" }, "Start of conversation"))],
    ...turns,
    ...(chat ? state.sent : []).map((reply) => [`l:${reply.localId}`, reply.status, () => localTurn(reply)]),
    // Rebuilt for each new tool call, so the line flashes once as the agent moves on; the run time ticks in place.
    ["activity", working && JSON.stringify([work.tool, work.calls, work.since]), working && (() => h("p", { class: "activity", role: "status" },
      h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
      h("span", { class: `activity-text${work.tool ? "" : " thinking"}` }, work.tool ?? "Thinking"),
      (work.calls || work.since) && h("span", { class: "activity-count" },
        work.calls ? `${work.calls} ${work.calls === 1 ? "tool" : "tools"}` : undefined,
        work.calls && work.since ? " · " : undefined,
        work.since ? h("span", { class: "activity-time", "data-since": String(work.since) }, runTime(work.since)) : undefined)))],
    ["request", request ? request.tone : "", request && (() => h("section", { class: `block ${request.tone}` }))],
  ]);
  if (request) sync(body.hubParts.get("request").el, request.parts);
  const canRead = Boolean(session.attention) || session.status === "waiting";
  // Mark read binds the conversation and request it shows, so a new request must rebuild the button.
  const readKey = canRead ? `${session.piSessionId}:${session.attention?.requestId ?? ""}` : "";
  const blocked = state.pending.has(session.id) || state.stale;
  const receipt = state.receipts.get(session.id);
  const open = session.canInteract && !unavailable;
  // The composer is rebuilt when its buttons change; the draft is in state, so only focus needs restoring.
  const typing = document.activeElement?.matches?.(".dock textarea");
  sync(dock, [
    ["pill", "pill", chat?.newMessages && (() => h("button", { class: "pill", type: "button", onclick: goToEnd }, "New messages ↓"))],
    ["receipt", JSON.stringify(receipt ?? null), receipt && (() => receiptLine(session.id))],
    ["closed", `${open}:${unavailable}`, !open && (() => h("p", { class: "notice" }, `${unavailable ?? "Session is not running"}. Open it in the terminal dashboard.`))],
    ["read", `${readKey}:${blocked}`, canRead && (() => h("div", { class: "chips" }, readChip(session, blocked)))],
    ["composer", `${draftKey(session)}:${session.instanceId}:${interaction?.messageDelivery}:${blocked}`, open && (() => composer(session, interaction))],
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
  let restore;
  if (id !== shownRoute) {
    // The list keeps its place across a visit to a session.
    if (!shownRoute) state.listY = window.scrollY;
    else if (!id) restore = state.listY;
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
    // The list is rebuilt whole; a typed answer keeps its focus and caret through the rebuild.
    const focused = document.activeElement?.dataset?.focus;
    const caret = focused && [document.activeElement.selectionStart, document.activeElement.selectionEnd];
    app.hubParts = undefined;
    app.replaceChildren(band, list);
    const field = focused && app.querySelector(`[data-focus="${CSS.escape(focused)}"]`);
    if (field) { field.focus({ preventScroll: true }); field.setSelectionRange(...caret); }
    if (restore !== undefined) window.scrollTo(0, restore);
  }
}

/** A session opened from the list marks its history entry, so its Back button can step back to that list. */
function openFromList(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState({ fromList: true }, "", event.currentTarget.getAttribute("href"));
  onRoute();
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

// The page restores the list's place itself; the browser's restore would race the rebuild.
history.scrollRestoration = "manual";
window.addEventListener("hashchange", onRoute);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  // Returning to the app: do not wait for the stale timer to notice a stream that died in the background.
  if (Date.now() - state.lastEventAt > STALE_MS / 2) connect();
  if (route()) void loadDetail();
});
setInterval(() => {
  watchConnection();
  for (const el of document.querySelectorAll(".activity-time")) el.textContent = runTime(Number(el.dataset.since));
}, 1_000);
window.addEventListener("scroll", () => {
  const chat = state.chat;
  if (!chat || !route()) return;
  const following = fromEnd() <= FOLLOW_PX;
  if (following === chat.following) return;
  chat.following = following;
  // The reader came back to the end by hand.
  if (following && chat.newMessages) goToEnd();
}, { passive: true });
setInterval(() => { if (route() && !document.hidden && !state.stale && !state.pending.size && !detailLoading) void loadDetail(); }, DETAIL_POLL_MS);
connect();
onRoute();
