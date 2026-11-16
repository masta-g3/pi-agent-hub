#!/usr/bin/env node
// Browser checks for the phone inbox page (`web/`), run by `npm run test:web`.
// The page is served by the built web server over an in-memory fleet: no registry, tmux or Pi.
// Usage: node scripts/web-check.mjs [name filter]
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const VIEWPORT = { width: 390, height: 844 };

function skip(reason) {
  console.error(`WARNING: web check skipped: ${reason}`);
  process.exit(0);
}

/** No dependency: use PLAYWRIGHT_PATH when set, else a Playwright already on this machine. */
async function loadPlaywright() {
  const candidates = process.env.PLAYWRIGHT_PATH ? [process.env.PLAYWRIGHT_PATH] : [
    join(repo, "node_modules", "playwright"),
    join(repo, "node_modules", "playwright-core"),
    join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "npm", "node_modules", "playwright"),
  ];
  const dir = candidates.find((candidate) => existsSync(join(candidate, "index.mjs")));
  if (!dir) skip(`no Playwright found in ${candidates.join(", ")}. Set PLAYWRIGHT_PATH to a playwright package directory.`);
  return (await import(pathToFileURL(join(dir, "index.mjs")).href)).chromium;
}

const chromium = await loadPlaywright();
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : { channel: "chrome" })
  .catch((error) => skip(`no browser: ${String(error.message).split("\n")[0]}. Set PLAYWRIGHT_CHROME to a Chrome executable.`));

const { createWebServer } = await import(pathToFileURL(join(repo, "dist/src/web/server.js")).href);
const { readConversation } = await import(pathToFileURL(join(repo, "dist/src/core/conversation.js")).href);
const { DELIVERY_UNCONFIRMED } = await import(pathToFileURL(join(repo, "dist/src/core/session-interaction.js")).href);

// ---- in-memory fleet ----

let world;
let web;

function session(id, overrides = {}) {
  return {
    id, title: `Session ${id}`, cwd: "/tmp", group: "default", tmuxSession: `pi-agent-hub-${id}`, status: "idle", createdAt: 1, updatedAt: 1,
    piSessionId: `pi-${id}`, interaction: { version: 1, instanceId: `inst-${id}` }, ...overrides,
  };
}
const attention = (kind, requestId, text) => ({ context: { version: 1, updatedAt: 10, attention: { requestId, kind, text } } });
const QUESTION = { toolCallId: "call-1", params: { questions: [{ question: "Which layout?", header: "Layout", options: [{ label: "Transcript", description: "Full width" }, { label: "Bubbles", description: "Messenger style" }] }] } };

function reset(sessions) {
  world = {
    sessions, branches: new Map(), pending: new Map(), busy: new Set(), calls: [], hold: undefined, fail: undefined, extraItems: [],
    skills: [], usage: undefined, record: false, failEarlier: undefined, readDelayMs: 0, openReads: 0, maxOpenReads: 0, next: 0,
  };
  web?.publish();
}

/** Append a message to a session's branch, as Pi would record it. */
function say(id, role, text, at = Date.now()) {
  const branch = world.branches.get(id) ?? [];
  world.branches.set(id, branch);
  const entry = { type: "message", id: `m${world.next += 1}`, timestamp: new Date(at).toISOString(), message: { role, content: [{ type: "text", text }] } };
  branch.push(entry);
  return entry;
}

/** `count` three-line messages, so a page of them is taller than the phone. */
function fill(id, count, at) {
  for (let index = 1; index <= count; index += 1) say(id, index % 2 ? "user" : "assistant", `Message ${index}\nsecond line\nthird line`, at);
}

function change(mutate) { mutate(); web.publish(); }
const held = () => new Promise((resolve) => { world.hold = resolve; });

web = createWebServer({
  staticDir: join(repo, "web"),
  sessions: () => world.sessions,
  async loadState(target) {
    return { answerChannel: "rpiv-events", questionProtocol: true, pending: world.pending.get(target.managedId) ?? [], messageDelivery: world.busy.has(target.managedId) ? "busy" : "idle", skills: world.skills };
  },
  async loadConversation(target, options = {}) {
    world.openReads += 1;
    world.maxOpenReads = Math.max(world.maxOpenReads, world.openReads);
    try {
      if (world.readDelayMs) await new Promise((resolve) => setTimeout(resolve, world.readDelayMs));
      if (options.before && world.failEarlier) throw world.failEarlier;
      if (options.branchId !== undefined && options.branchId !== "branch") throw new Error("Conversation branch changed");
      const page = readConversation(world.branches.get(target.managedId) ?? [], { branchId: "branch", before: options.before, limit: 20 });
      return options.before ? page : { ...page, items: [...page.items, ...world.extraItems] };
    } finally { world.openReads -= 1; }
  },
  async submitAnswer(target, toolCallId, answers) {
    world.calls.push(`answer:${target.managedId}:${toolCallId}:${JSON.stringify(answers)}`);
    world.pending.delete(target.managedId);
  },
  async sendMessage(target, text, delivery) {
    world.calls.push(`send:${target.managedId}:${delivery}:${text}`);
    if (world.hold === null) await held();
    if (world.fail) throw world.fail;
    // Pi records a message to an idle agent at once; a steered or queued one later.
    if (world.record && delivery === "send") say(target.managedId, "user", text);
  },
  async acknowledge(id, requestId) { world.calls.push(`ack:${id}:${requestId}`); },
  async touch() {},
  shortcuts: [{ key: "c", send: "/skill:commit", label: "Commit" }],
  async runShortcut(target, key, send) { world.calls.push(`shortcut:${target.managedId}:${key}:${send}`); },
  async resume(id) {
    world.calls.push(`resume:${id}`);
    change(() => { world.sessions = world.sessions.map((row) => row.id === id ? { ...row, status: "idle" } : row); });
  },
  newSession: {
    options: () => ({ repos: ["/src/alpha", "/src/beta"], groups: ["default", "ui"] }),
    async create(input) {
      world.calls.push(`create:${input.cwd}:${input.group}`);
      change(() => { world.sessions = [...world.sessions, session("fresh", { title: "New · beta", group: input.group, status: "starting", piSessionId: undefined, interaction: undefined })]; });
      return "fresh";
    },
  },
  usage: () => world.usage,
});
reset([]);
const serverPort = await new Promise((resolve) => web.server.listen(0, "127.0.0.1", () => resolve(web.server.address().port)));

// ---- proxy that can silence event streams, as a suspended phone does ----

const pairs = new Set();
let silenceStreams = false;
const proxy = createServer((client) => {
  const upstream = createConnection(serverPort, "127.0.0.1");
  const pair = { client, upstream, stream: false, silent: false };
  pairs.add(pair);
  client.on("data", (data) => { if (!pair.silent) upstream.write(data); });
  upstream.on("data", (data) => {
    if (data.includes("text/event-stream")) { pair.stream = true; pair.silent = silenceStreams; }
    if (!pair.silent) client.write(data);
  });
  const end = () => { pairs.delete(pair); client.destroy(); upstream.destroy(); };
  for (const socket of [client, upstream]) { socket.on("close", end); socket.on("error", end); }
});
const stall = () => { silenceStreams = true; for (const pair of pairs) if (pair.stream) pair.silent = true; };
const resume = () => { silenceStreams = false; for (const pair of pairs) if (pair.silent) pair.client.destroy(); };
const port = await new Promise((resolve) => proxy.listen(0, "127.0.0.1", () => resolve(proxy.address().port)));
const base = `http://127.0.0.1:${port}`;

// ---- checks ----

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const reply = (page) => page.getByLabel("Reply");
const sends = () => world.calls.filter((call) => call.startsWith("send:"));

async function open(page, path = "/") {
  await page.goto("about:blank");
  await page.goto(`${base}${path}`);
}

check("list shows requests first, in the Status tiers", async (page) => {
  reset([session("run", { status: "running" }), session("ask", { status: "waiting", ...attention("ready", "r1", "Plan is ready") })]);
  await open(page);
  await page.getByText("Plan is ready").waitFor();
  assert.deepEqual(await page.locator(".tier-head").evaluateAll((heads) => heads.map((head) => head.textContent.replace(/[▸▾]/u, "").trim())), ["NEEDS YOU· 1", "ACTIVE· 1"]);
});

check("a list card answer needs a tap to select and a second tap to send", async (page) => {
  reset([session("ask", { status: "waiting", ...attention("question", "r1", "Which layout?") })]);
  world.pending.set("ask", [QUESTION]);
  await open(page);
  await page.getByRole("button", { name: /^Transcript/u }).click();
  await page.getByRole("button", { name: "Send answer" }).waitFor();
  assert.deepEqual(world.calls, []);
  await page.getByRole("button", { name: "Send answer" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  // An accepted answer also dismisses the request it answered.
  assert.deepEqual(world.calls, ['answer:ask:call-1:[{"questionIndex":0,"kind":"option","optionIndex":0}]', "ack:ask:r1"]);
});

check("a list card steps through several questions and sends them together", async (page) => {
  const questions = [
    { question: "Which layout?", header: "Layout", options: [{ label: "Transcript", description: "Full width" }, { label: "Bubbles", description: "Messenger style" }] },
    { question: "Which extras?", header: "Extras", multiSelect: true, options: [{ label: "Times", description: "" }, { label: "Avatars", description: "" }] },
    { question: "Anything else?", header: "Notes", options: [{ label: "No", description: "" }, { label: "Yes", description: "" }] },
  ];
  reset([session("ask", { status: "waiting", ...attention("question", "r1", "Three questions") })]);
  world.pending.set("ask", [{ toolCallId: "call-3", params: { questions } }]);
  await open(page);
  await page.getByText("Layout · 1 of 3").waitFor();
  // The card shows the question whole, not only its first sentence.
  assert.equal(await page.getByText("delete every backup").count(), 0);
  // A single choice moves on by itself.
  await page.getByRole("button", { name: /^Bubbles/u }).click();
  await page.getByText("Extras · 2 of 3").waitFor();
  assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), true);
  await page.getByRole("button", { name: /^Times/u }).click();
  await page.getByRole("button", { name: /^Avatars/u }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Notes · 3 of 3").waitFor();
  assert.equal(await page.getByRole("button", { name: "Answer each question" }).isDisabled(), true);
  // A typed answer keeps focus through live list rebuilds.
  await page.getByLabel("Type an answer").click();
  await page.keyboard.type("Ship it");
  change(() => { world.sessions = [{ ...world.sessions[0], title: "Renamed" }]; });
  await page.getByText("Renamed").waitFor();
  await page.keyboard.type(" today");
  assert.equal(await page.getByLabel("Type an answer").inputValue(), "Ship it today");
  // Back keeps earlier answers.
  await page.getByRole("button", { name: "‹ Back" }).click();
  assert.equal(await page.getByRole("button", { name: /^Avatars/u }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Question 3" }).click();
  assert.deepEqual(world.calls, []);
  await page.getByRole("button", { name: "Send 3 answers" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(world.calls, ['answer:ask:call-3:[{"questionIndex":0,"kind":"option","optionIndex":1},{"questionIndex":1,"kind":"multi","optionIndices":[0,1]},{"questionIndex":2,"kind":"custom","text":"Ship it today"}]', "ack:ask:r1"]);
});

check("a list card shows conditions, and leaves several pending questionnaires to the chat", async (page) => {
  const ask = { question: "Can I proceed: (1) delete every backup (2) restart production?", header: "Proceed", options: [{ label: "Yes", description: "" }, { label: "No", description: "" }] };
  reset([session("ask", { status: "waiting", ...attention("question", "r1", "Can I proceed?") })]);
  world.pending.set("ask", [{ toolCallId: "c1", params: { questions: [ask] } }]);
  await open(page);
  await page.getByText("Proceed", { exact: true }).waitFor();
  assert.equal(await page.locator(".stepper").getByText(/delete every backup/u).count(), 1);
  reset([session("two", { status: "waiting", ...attention("question", "r2", "Two forms") })]);
  world.pending.set("two", [{ toolCallId: "c1", params: { questions: [ask] } }, { toolCallId: "c2", params: { questions: [ask] } }]);
  await open(page);
  await page.getByText("Two forms").waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".stepper").count(), 0);
});

check("a reply posts once, shows Accepted and clears the draft", async (page) => {
  reset([session("a")]);
  await open(page, "/#/s/a");
  await reply(page).fill("hello agent");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(sends(), ["send:a:send:hello agent"]);
  assert.equal(await reply(page).getAttribute("autocomplete"), "off", "no contact AutoFill in the reply box");
  assert.equal(await reply(page).inputValue(), "");
});

check("text typed while a reply is in flight survives", async (page) => {
  reset([session("a")]);
  world.hold = null;
  await open(page, "/#/s/a");
  await reply(page).fill("first");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Submitting…").waitFor();
  await reply(page).fill("second thought");
  world.hold();
  await page.getByText(/^Accepted/u).waitFor();
  assert.equal(await reply(page).inputValue(), "second thought");
  assert.equal(sends().length, 1);
});

check("Mark read sends the request shown after it changed", async (page) => {
  reset([session("a", { status: "waiting", ...attention("ready", "r1", "Ready one") })]);
  await open(page, "/#/s/a");
  await page.getByText("Ready one").waitFor();
  change(() => { world.sessions = [session("a", { status: "waiting", ...attention("ready", "r2", "Ready two") })]; });
  await page.getByText("Ready two").waitFor();
  await page.getByRole("button", { name: "Mark read" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(world.calls, ["ack:a:r2"]);
});

check("a silent stream shows Reconnecting, blocks Send, then recovers", async (page) => {
  reset([session("a")]);
  await open(page, "/#/s/a");
  await page.getByRole("button", { name: "Send" }).waitFor();
  stall();
  try {
    await page.getByText(/^Reconnecting/u).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole("button", { name: "Send" }).isDisabled(), true);
  } finally { resume(); }
  await page.locator(".conn.on").waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole("button", { name: "Send" }).isDisabled(), false);
});

// ---- controls ----

check("a completed step offers Next with its skill, and shortcuts run as chips", async (page) => {
  reset([session("a", { workflow: { steps: [{ id: "execute", short: "EX" }, { id: "review", short: "RV" }], activeIndex: 0, currentStepComplete: true, updatedAt: 1 } })]);
  world.skills = [{ name: "review", description: "" }];
  await open(page, "/#/s/a");
  await page.getByRole("button", { name: "Next: /review" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(sends(), ["send:a:send:/skill:review"]);
  await page.getByRole("button", { name: "Commit" }).click();
  await page.waitForFunction(() => document.querySelector(".receipt")?.textContent.startsWith("Accepted"));
  await page.waitForTimeout(200);
  assert.ok(world.calls.includes("shortcut:a:c:/skill:commit"));
});

check("a stopped session offers Resume, and the composer returns once it runs", async (page) => {
  reset([session("a", { status: "stopped" })]);
  await open(page, "/#/s/a");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(world.calls, ["resume:a"]);
  await reply(page).waitFor();
});

check("+ starts a session in a listed repository and opens it", async (page) => {
  reset([session("a")]);
  await open(page);
  await page.getByRole("button", { name: "New session" }).click();
  await page.getByRole("radio", { name: /beta/u }).check();
  // The group follows the chosen repository until it is typed.
  assert.equal(await page.getByLabel("Group").inputValue(), "beta");
  await page.getByLabel("Group").fill("ui");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.locator(".band-name", { hasText: "New · beta" }).waitFor();
  assert.deepEqual(world.calls, ["create:/src/beta:ui"]);
});

check("the band shows the tightest quota and its sheet lists every window", async (page) => {
  reset([session("a")]);
  await open(page);
  await page.locator(".band-title").waitFor();
  assert.equal(await page.locator(".quota").count(), 0);
  world.usage = { accounts: [
    { producer: "p", id: "c", provider: "x", label: "Claude", fetchedAt: Date.now(), windows: [{ id: "5h", label: "5h", remainingPercent: 64 }, { id: "7d", label: "7d", remainingPercent: 18, resetAt: Date.now() + 3_600_000 }] },
    { producer: "p", id: "o", provider: "y", label: "Codex", fetchedAt: Date.now(), windows: [{ id: "5h", label: "5h", remainingPercent: 90 }] },
  ], histories: [], producers: ["p"], hiddenTimeZones: 0 };
  change(() => { world.sessions = [session("a", { title: "Tick" })]; });
  await page.locator(".quota", { hasText: "18%" }).click();
  for (const text of ["Claude", "Codex", "64% left", "18% left", "90% left"]) await page.locator("dialog").getByText(text).waitFor();
  assert.match(await page.locator("dialog").textContent(), /resets in 1h/u);
});

check("search filters every tier and Archived, and clears", async (page) => {
  reset([
    session("a", { title: "Auth login" }), session("b", { title: "Billing", group: "payments" }),
    session("old", { title: "Old auth spike", bucket: "archived", bucketChangedAt: 5 }),
  ]);
  await open(page);
  await page.getByRole("button", { name: /^QUIET/u }).waitFor();
  // Archived is collapsed until opened.
  assert.equal(await page.getByText("Old auth spike").count(), 0);
  await page.getByRole("button", { name: /^ARCHIVED/u }).click();
  await page.getByText("Old auth spike").waitFor();
  await page.getByRole("button", { name: /^ARCHIVED/u }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await page.keyboard.type("auth");
  await page.getByText("Old auth spike").waitFor();
  assert.equal(await page.getByText("Billing").count(), 0);
  await page.getByLabel("Search sessions").fill("payments");
  await page.getByText("Billing").waitFor();
  await page.getByLabel("Search sessions").fill("zzz");
  await page.getByText("No matches").waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  // Folding returns with the full list.
  await page.getByRole("button", { name: /^QUIET/u }).waitFor();
  assert.equal(await page.getByLabel("Search sessions").count(), 0);
  assert.equal(await page.getByText("Auth login").count(), 0);
});

// ---- Markdown ----

const MARKDOWN = [
  "## Result", "", "Fixed **two** things, *quickly*, with ~~no~~ `code`:", "",
  "1. Reopen the stream", "2. Refetch", "   - nested item", "",
  "```ts", "const answer = 42;", "```", "",
  "| File | Lines |", "|:-----|------:|", "| app.js | 556 |", "",
  "> quoted", "", "---", "",
  "See [the docs](https://example.com/docs) and [a trap](javascript:alert(1)).", "",
  "<img src=x onerror=\"window.hacked = 1\"> <script>window.hacked = 1</script>",
].join("\n");

check("an agent message renders Markdown as elements", async (page) => {
  reset([session("a")]);
  say("a", "assistant", MARKDOWN);
  await open(page, "/#/s/a");
  const turn = page.locator(".turn.is-assistant");
  await turn.locator("h2", { hasText: "Result" }).waitFor();
  for (const selector of ["strong", "em", "del", "p code", "ol > li", "ol ul > li", "blockquote", "hr", "table th", "table td"]) {
    assert.ok(await turn.locator(selector).count(), `missing ${selector}`);
  }
  assert.equal(await turn.locator("pre code").textContent(), "const answer = 42;");
  assert.equal(await turn.locator(".md-code").getAttribute("data-lang"), "ts");
  assert.equal(await turn.locator(".md-lang").textContent(), "ts");
  assert.equal(await turn.locator("td.md-right").textContent(), "556");
  const link = turn.locator("a", { hasText: "the docs" });
  assert.equal(await link.getAttribute("href"), "https://example.com/docs");
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(await link.getAttribute("target"), "_blank");
});

check("message text cannot become HTML or a script link", async (page) => {
  reset([session("a")]);
  say("a", "assistant", MARKDOWN);
  say("a", "user", "<img src=x onerror=\"window.hacked = 1\"> **not bold**");
  await open(page, "/#/s/a");
  await page.locator(".turn.is-user").waitFor();
  const transcript = page.locator(".transcript");
  assert.equal(await transcript.locator("img, script, iframe, object, embed").count(), 0);
  assert.equal(await transcript.locator("a").count(), 1, "only the https link is a link");
  assert.match(await page.locator(".turn.is-assistant").textContent(), /\[a trap\]\(javascript:alert\(1\)\)/u);
  assert.match(await page.locator(".turn.is-assistant").textContent(), /<img src=x onerror=/u);
  // What the user typed is shown as typed, not as Markdown.
  assert.equal(await page.locator(".turn.is-user strong").count(), 0);
  assert.match(await page.locator(".turn.is-user").textContent(), /\*\*not bold\*\*/u);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
});

// ---- chat ----

const fromEnd = (page) => page.evaluate(() => document.documentElement.scrollHeight - window.scrollY - window.innerHeight);
const turns = (page) => page.locator(".turn");
const turnWith = (page, text) => page.locator(".turn", { hasText: text });
/** Scroll like a reader does, and let the page see the scroll event. */
async function scrollTo(page, top) {
  await page.evaluate((y) => window.scrollTo(0, y), top);
  await page.waitForTimeout(150);
}
async function openChat(page, id = "a") {
  await open(page, `/#/s/${id}`);
  await turns(page).first().waitFor();
}

check("a new message appears on the open screen and the view follows it", async (page) => {
  reset([session("a")]);
  fill("a", 30);
  await openChat(page);
  assert.ok(await fromEnd(page) <= 2, "a session opens at its newest message");
  assert.equal(await turns(page).count(), 20);
  say("a", "assistant", "Fresh from the agent");
  await turnWith(page, "Fresh from the agent").waitFor({ timeout: 3_000 });
  await page.waitForTimeout(100);
  assert.ok(await fromEnd(page) <= 2, "the view follows a new message");
  assert.equal(new URL(page.url()).hash, "#/s/a");
});

check("a new message taller than the screen is shown from its first line", async (page) => {
  reset([session("a")]);
  fill("a", 30);
  await openChat(page);
  say("a", "assistant", Array.from({ length: 60 }, (_, index) => `Tall line ${index + 1}`).join("\n\n"));
  const tall = turnWith(page, "Tall line 1");
  await tall.waitFor({ timeout: 3_000 });
  await page.waitForTimeout(200);
  const place = await page.evaluate(() => {
    const turn = [...document.querySelectorAll(".turn")].at(-1).getBoundingClientRect();
    return { top: Math.round(turn.top), band: Math.round(document.querySelector(".band").getBoundingClientRect().bottom) };
  });
  assert.ok(place.top >= place.band && place.top <= place.band + 40, JSON.stringify(place));
});

check("a reader who scrolled up keeps their place and gets a New messages pill", async (page) => {
  reset([session("a")]);
  fill("a", 30);
  await openChat(page);
  await scrollTo(page, 300);
  assert.equal(await page.locator(".pill").count(), 0);
  say("a", "assistant", "Arrived while reading");
  await page.locator(".pill").waitFor({ timeout: 3_000 });
  assert.equal(await page.locator(".pill").textContent(), "New messages ↓");
  assert.equal(await page.evaluate(() => window.scrollY), 300);
  await page.locator(".pill").click();
  await page.waitForTimeout(300);
  assert.ok(await fromEnd(page) <= 2);
  assert.equal(await page.locator(".pill").count(), 0);
  assert.equal(await turnWith(page, "Arrived while reading").count(), 1);
});

check("Earlier messages loads history and keeps the reading position", async (page) => {
  reset([session("a")]);
  fill("a", 45);
  await openChat(page);
  await scrollTo(page, 0);
  // Follow a message by its text: its element is rebuilt when its time label changes.
  const top = (label) => page.evaluate((text) => Math.round([...document.querySelectorAll(".turn-body")].find((body) => new RegExp(`^${text}(?!\\d)`, "u").test(body.textContent)).getBoundingClientRect().top), label);
  const before = await top("Message 26");
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".turn").length === 40);
  assert.equal(await top("Message 26"), before, "the first visible message stays where it was");
  assert.ok(await page.evaluate(() => window.scrollY) > 500, "history was added above the reader");

  // A message that arrives while history loads must not move the reader either.
  await scrollTo(page, 0);
  const second = await top("Message 6");
  world.readDelayMs = 700;
  await page.getByRole("button", { name: "Earlier messages" }).click();
  assert.equal(await page.getByRole("button", { name: "Earlier messages" }).isDisabled(), true);
  say("a", "assistant", "Arrived during the load");
  await page.waitForFunction(() => document.querySelectorAll(".turn").length === 46);
  world.readDelayMs = 0;
  assert.equal(await top("Message 6"), second);
  assert.equal(await page.getByRole("button", { name: "Earlier messages" }).count(), 0);
  assert.equal(await page.getByText("Start of conversation").count(), 1);
  assert.deepEqual(await turns(page).first().locator(".turn-body").textContent(), "Message 1\nsecond line\nthird line");
  assert.equal(await page.locator(".pill").count(), 1);
});

check("a failed read of earlier messages keeps the history already loaded", async (page) => {
  reset([session("a")]);
  fill("a", 65);
  await openChat(page);
  await scrollTo(page, 0);
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".turn").length === 40);
  await scrollTo(page, 0);
  world.failEarlier = new Error("Session interaction timed out");
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await page.waitForTimeout(1_000);
  assert.equal(await turns(page).count(), 40);
  assert.equal(await page.evaluate(() => window.scrollY), 0, "the reader is not moved");
  assert.equal(await page.getByRole("button", { name: "Earlier messages" }).isDisabled(), false);

  // A branch the session has left: the history is gone, so the screen restarts at the newest page.
  world.failEarlier = new Error("Conversation branch changed");
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".turn").length === 20);
});

check("a message whose text changed is updated in place", async (page) => {
  reset([session("a")]);
  const first = say("a", "assistant", "Draft answer");
  say("a", "user", "Thanks");
  await openChat(page);
  await page.evaluate(() => { document.querySelector(".turn.is-user").hubKept = true; });
  first.message.content[0].text = "Final **answer**";
  await page.locator(".turn.is-assistant strong", { hasText: "answer" }).waitFor({ timeout: 3_000 });
  assert.equal(await turnWith(page, "Draft answer").count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector(".turn.is-user").hubKept), true, "an unchanged message keeps its element");
});

check("long code lines and wide tables scroll inside their own block", async (page) => {
  reset([session("a")]);
  say("a", "assistant", ["```sh", `echo ${"x".repeat(200)}`, "```", "", "| a | b | c | d | e | f |", "|---|---|---|---|---|---|",
    `| ${Array.from({ length: 6 }, (_, index) => `column ${index} is wide`).join(" | ")} |`, "", `A long word: ${"y".repeat(200)}`, "", `inline \`${"z".repeat(120)}\` code`].join("\n"));
  await openChat(page);
  const sizes = await page.evaluate(() => {
    const overflow = (element) => element.scrollWidth - element.clientWidth;
    return { page: overflow(document.documentElement), code: overflow(document.querySelector(".md-code pre")), table: overflow(document.querySelector(".md-table")) };
  });
  assert.ok(sizes.page <= 0, `the page scrolls sideways by ${sizes.page} px`);
  assert.ok(sizes.code > 0, "the code block scrolls inside itself");
  assert.ok(sizes.table > 0, "the table scrolls inside its wrapper");
});

check("a pending question shows once, as the answer form", async (page) => {
  reset([session("a", { status: "waiting", ...attention("question", "r1", "Which layout?") })]);
  say("a", "user", "Start");
  world.branches.get("a").push({ type: "message", id: "ask", message: { role: "assistant", content: [{ type: "text", text: "I need a choice." },
    { type: "toolCall", id: "call-1", name: "ask_user_question", arguments: QUESTION.params }] } });
  world.pending.set("a", [QUESTION]);
  await openChat(page);
  await page.getByRole("radio").first().waitFor();
  assert.equal(await page.locator(".turn.is-question").count(), 0);
  assert.equal(await page.locator(".question").count(), 1);
  assert.equal(await page.getByText("Which layout?").count(), 1);
  await page.getByText("Transcript", { exact: true }).click();
  await page.getByRole("button", { name: "Send answer" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  assert.deepEqual(world.calls.filter((call) => call.startsWith("answer:")), ['answer:a:call-1:[{"questionIndex":0,"kind":"option","optionIndex":0}]']);
  // Once answered, the question is history.
  await page.locator(".turn.is-question").waitFor({ timeout: 3_000 });
});

check("typed text and focus in the composer survive live updates", async (page) => {
  reset([session("a")]);
  fill("a", 3);
  await openChat(page);
  await reply(page).click();
  await page.keyboard.type("half a thou");
  await page.evaluate(() => { document.querySelector(".dock textarea").hubKept = true; });
  await page.waitForTimeout(5_000);
  say("a", "assistant", "Interrupting message");
  await turnWith(page, "Interrupting message").waitFor({ timeout: 3_000 });
  await page.keyboard.type("ght");
  assert.equal(await reply(page).inputValue(), "half a thought");
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".dock textarea") && document.activeElement.hubKept), true);
});

check("an activity line shows only while the agent works", async (page) => {
  const running = (activity) => session("a", { status: "running", activity, statusEvidence: { observedAt: 1, reason: "heartbeat-active", tmux: { state: "present" },
    heartbeat: { freshness: "fresh", state: "running", stateSince: Date.now() - 125_000 }, acknowledgement: { state: "not-applicable" }, workflow: { source: "absent" } } });
  reset([running({ current: { tool: "bash", detail: "npm test", at: 1 }, calls: 14 })]);
  fill("a", 2);
  await openChat(page);
  await page.locator(".activity").waitFor();
  assert.match(await page.locator(".activity-text").textContent(), /^bash npm test$/u);
  assert.match(await page.locator(".activity-count").textContent(), /^14 tools · 2m$/u);
  // A new call rebuilds the line, which flashes once.
  await page.evaluate(() => { document.querySelector(".activity").hubKept = true; });
  change(() => { world.sessions = [running({ current: { tool: "read", detail: "a.ts", at: 2 }, calls: 15 })]; });
  await page.locator(".activity-count", { hasText: "15 tools" }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector(".activity").hubKept), undefined);
  // A run that starts without a tool gains its timer once the heartbeat reports the run.
  change(() => { world.sessions = [session("a", { status: "running" })]; });
  await page.waitForFunction(() => !document.querySelector(".activity-time"));
  change(() => { world.sessions = [running({ current: { tool: "read", detail: "a.ts", at: 2 }, calls: 15 })]; });
  await page.locator(".activity-time").waitFor();
  // No tool in flight: the agent is thinking.
  change(() => { world.sessions = [running({ calls: 15 })]; });
  await page.locator(".activity-text.thinking", { hasText: "Thinking" }).waitFor();
  // The list shows the same, never an older progress note.
  change(() => { world.sessions = [{ ...running({ calls: 15 }), context: { version: 1, updatedAt: 1, progress: { next: "Old note", updatedAt: 1 } } }]; });
  await page.goto(`${base}/`);
  await page.locator(".sub.thinking", { hasText: "Thinking" }).waitFor();
  assert.equal(await page.getByText("Old note").count(), 0);
  await page.goBack();
  await page.locator(".activity").waitFor();
  change(() => { world.sessions = [session("a", { status: "idle" })]; });
  await page.waitForFunction(() => !document.querySelector(".activity"));
});

check("the dock never covers the last message or the request", async (page) => {
  reset([session("a", { status: "waiting", ...attention("ready", "r1", "Plan is ready for review") })]);
  fill("a", 30);
  await openChat(page);
  const gap = () => page.evaluate(() => {
    const dock = document.querySelector(".dock").getBoundingClientRect();
    const last = [...document.querySelectorAll(".transcript > *")].at(-1).getBoundingClientRect();
    const turn = [...document.querySelectorAll(".turn")].at(-1).getBoundingClientRect();
    return { last: dock.top - last.bottom, turn: dock.top - turn.bottom, dockBottom: Math.round(dock.bottom), viewport: window.innerHeight };
  });
  await page.getByText("Plan is ready for review").waitFor();
  await page.waitForTimeout(200);
  let space = await gap();
  assert.ok(space.last >= 0 && space.turn >= 0, `covered by ${JSON.stringify(space)}`);
  assert.equal(space.dockBottom, space.viewport);

  const oneLine = await page.evaluate(() => document.querySelector(".dock textarea").offsetHeight);
  await reply(page).fill("one\ntwo\nthree\nfour\nfive\nsix");
  await page.waitForTimeout(200);
  const sixLines = await page.evaluate(() => document.querySelector(".dock textarea").offsetHeight);
  assert.ok(sixLines > oneLine * 2, `the composer grows: ${oneLine} to ${sixLines}`);
  space = await gap();
  assert.ok(space.last >= 0 && space.turn >= 0, `covered with a tall composer by ${JSON.stringify(space)}`);
  assert.ok(await fromEnd(page) <= 2, "the view still ends at the newest content");

  await reply(page).fill(Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"));
  await page.waitForTimeout(200);
  const capped = await page.evaluate(() => document.querySelector(".dock textarea").offsetHeight);
  assert.ok(capped <= Math.max(sixLines, 844 * 0.3) + 2, `the composer stops growing: ${capped}`);
});

check("slow reads never overlap and messages still arrive", async (page) => {
  reset([session("a")]);
  fill("a", 3);
  world.readDelayMs = 2_000;
  await openChat(page);
  say("a", "assistant", "Slow but here");
  await turnWith(page, "Slow but here").waitFor({ timeout: 8_000 });
  await page.waitForTimeout(3_000);
  assert.equal(world.maxOpenReads, 1);
});

check("a reply sent while a read is in flight ends with the newest transcript", async (page) => {
  reset([session("a")]);
  fill("a", 3);
  world.record = true;
  world.readDelayMs = 1_200;
  await openChat(page);
  // With reads this slow, one is in flight whenever the reply is sent.
  await page.waitForTimeout(1_600);
  await reply(page).fill("sent during a read");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/^Accepted/u).waitFor();
  await page.locator(".turn.is-user:not(.local)", { hasText: "sent during a read" }).waitFor({ timeout: 6_000 });
  await page.waitForTimeout(2_000);
  assert.equal(await turnWith(page, "sent during a read").count(), 1);
  assert.deepEqual(sends(), ["send:a:send:sent during a read"]);
});

check("a sent reply shows at once and is replaced by Pi's record", async (page) => {
  reset([session("a", { status: "running" })]);
  fill("a", 3);
  world.busy.add("a");
  world.hold = null;
  await openChat(page);
  await reply(page).fill("queue this  one");
  await page.getByRole("button", { name: "Queue" }).click();
  const local = page.locator(".turn.local");
  await local.locator(".turn-state", { hasText: "Sending…" }).waitFor();
  assert.equal(await local.locator(".turn-body").textContent(), "queue this  one");
  world.hold();
  await local.locator(".turn-state", { hasText: "Queued" }).waitFor();
  assert.equal(await reply(page).inputValue(), "");

  await reply(page).fill("steer now");
  await page.getByRole("button", { name: "Steer" }).click();
  await page.locator(".turn.local .turn-state", { hasText: "Sent" }).waitFor();
  assert.equal(await local.count(), 2);

  // Pi delivers the steered message first, then the queued one.
  say("a", "user", "steer now");
  await page.waitForFunction(() => document.querySelectorAll(".turn.local").length === 1, undefined, { timeout: 3_000 });
  say("a", "assistant", "On it");
  say("a", "user", "queue this one");
  await page.waitForFunction(() => document.querySelectorAll(".turn.local").length === 0, undefined, { timeout: 3_000 });
  assert.equal(await turnWith(page, "steer now").count(), 1);
  assert.equal(await turnWith(page, /queue this\s+one/u).count(), 1);
  assert.deepEqual(sends(), ["send:a:followUp:queue this  one", "send:a:steer:steer now"]);
});

check("a slash command gets a receipt and no local turn", async (page) => {
  reset([session("a")]);
  fill("a", 3);
  world.hold = null;
  await openChat(page);
  await reply(page).fill("/compact");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Submitting…").waitFor();
  assert.equal(await page.locator(".turn.local").count(), 0);
  world.hold();
  await page.getByText(/^Accepted/u).waitFor();
  assert.equal(await page.locator(".turn.local").count(), 0);
  assert.deepEqual(sends(), ["send:a:send:/compact"]);
});

check("a rejected reply leaves no local turn; a lost response is marked unknown and never resent", async (page) => {
  reset([session("a")]);
  fill("a", 3);
  world.fail = new Error("Pi started working; choose Steer now or Queue for later");
  await openChat(page);
  await reply(page).fill("will be rejected");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/^Rejected · Pi started working/u).waitFor();
  assert.equal(await page.locator(".turn.local").count(), 0);
  assert.equal(await reply(page).inputValue(), "will be rejected");

  world.fail = new Error(DELIVERY_UNCONFIRMED);
  await reply(page).fill("maybe delivered");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/^Delivery unknown/u).first().waitFor();
  await page.locator(".turn.local .turn-state", { hasText: "Delivery unknown" }).waitFor();
  await page.waitForTimeout(4_000);
  assert.equal(await page.locator(".turn.local").count(), 1);
  assert.deepEqual(sends(), ["send:a:send:will be rejected", "send:a:send:maybe delivered"]);
});

check("turns are labeled, timed only after a pause, and unknown kinds stay readable", async (page) => {
  reset([session("a", { title: "A long session title that needs more than one line on a phone", context: { version: 1, updatedAt: 1, ticket: { id: "web-002", title: "Phone chat view", subtitle: "Live chat" } } })]);
  const base = Date.UTC(2026, 10, 11, 14, 0);
  say("a", "user", "First", base);
  say("a", "assistant", "Quick reply", base + 60_000);
  say("a", "user", "Much later", base + 11 * 60_000);
  world.extraItems = [{ id: "x1", role: "tool", text: "exit 0\n**raw**" }];
  await openChat(page);
  // You and the agent are told apart by layout; their names stay for screen readers only.
  const roles = await page.locator(".turn .turn-role").evaluateAll((all) => all.map((role) => [role.textContent, role.classList.contains("sr")]));
  assert.deepEqual(roles, [["You", true], ["Agent", true], ["You", true], ["TOOL", false]]);
  assert.deepEqual(await page.locator(".turn").evaluateAll((all) => all.map((turn) => Boolean(turn.querySelector("time")))), [true, false, true, false]);
  assert.equal(await page.locator(".turn.is-tool .turn-body").textContent(), "exit 0\n**raw**");
  const place = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return { you: box(".turn.is-user .turn-body").right, agent: box(".turn.is-assistant .turn-body").left, width: innerWidth };
  });
  assert.ok(place.you > place.width - 30 && place.agent < 30, `your turns sit right, the agent's left: ${JSON.stringify(place)}`);
  // The band names the session once, on one line, with its state under it; the ticket opens the transcript.
  const band = await page.evaluate(() => ({ height: document.querySelector(".band").offsetHeight, name: document.querySelector(".band-name").scrollWidth > document.querySelector(".band-name").clientWidth }));
  assert.ok(band.height <= 76 && band.name, JSON.stringify(band));
  assert.equal(await page.getByText("A long session title that needs more than one line on a phone").count(), 1);
  assert.match(await page.locator(".band-sub").textContent(), /Idle/u);
  assert.match(await page.locator(".intro").textContent(), /web-002 · Live chat/u);
});

check("a message written before a tool call is quieter than the turn's final reply", async (page) => {
  reset([session("a")]);
  say("a", "user", "Fix it");
  world.branches.get("a").push({ type: "message", id: "w1", timestamp: new Date().toISOString(), message: { role: "assistant",
    content: [{ type: "text", text: "Running tests first." }, { type: "toolCall", id: "t1", name: "bash", arguments: {} }] } });
  say("a", "assistant", "Fixed.");
  await openChat(page);
  await turnWith(page, "Fixed.").waitFor();
  await page.getByRole("button", { name: "1 note" }).click();
  await turnWith(page, "Running tests first.").waitFor();
  assert.deepEqual(await page.locator(".turn.is-assistant").evaluateAll((all) => all.map((turn) => turn.classList.contains("interim"))), [true, false]);
  const sizes = await page.evaluate(() => [...document.querySelectorAll(".turn.is-assistant .turn-body")].map((body) => getComputedStyle(body).fontSize));
  assert.ok(parseFloat(sizes[0]) < parseFloat(sizes[1]), JSON.stringify(sizes));
});

check("notes written between tool calls fold into one line per turn; the newest shows while it works", async (page) => {
  const note = (id, text) => world.branches.get("a").push({ type: "message", id, timestamp: new Date().toISOString(), message: { role: "assistant",
    content: [{ type: "text", text }, { type: "toolCall", id: `t-${id}`, name: "bash", arguments: {} }] } });
  reset([session("a", { status: "running" })]);
  say("a", "user", "Fix it");
  note("n1", "Reading the layout.");
  note("n2", "Running tests first.");
  await openChat(page);
  // While the agent works, the newest note stays readable under the fold.
  await page.getByRole("button", { name: "1 earlier note" }).waitFor();
  assert.equal(await turnWith(page, "Running tests first.").isVisible(), true);
  assert.equal(await turnWith(page, "Reading the layout.").isVisible(), false);
  change(() => { say("a", "assistant", "Fixed."); world.sessions = [session("a")]; });
  await turnWith(page, "Fixed.").waitFor();
  await page.getByRole("button", { name: "2 notes" }).waitFor();
  assert.equal(await turnWith(page, "Running tests first.").isVisible(), false);
  // Opening a fold keeps it open through live updates; each turn folds on its own.
  await page.getByRole("button", { name: "2 notes" }).click();
  await turnWith(page, "Reading the layout.").waitFor();
  say("a", "user", "Again");
  note("n3", "Checking once more.");
  say("a", "assistant", "Done.");
  await turnWith(page, "Done.").waitFor({ timeout: 10_000 });
  assert.equal(await turnWith(page, "Reading the layout.").isVisible(), true);
  assert.equal(await turnWith(page, "Checking once more.").isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "1 note" }).count(), 1);
});

check("opening a fold keeps it in place and focused; earlier pages keep the reading position with folds", async (page) => {
  const note = (id, text) => world.branches.get("a").push({ type: "message", id, timestamp: new Date().toISOString(), message: { role: "assistant",
    content: [{ type: "text", text }, { type: "toolCall", id: `t-${id}`, name: "bash", arguments: {} }] } });
  reset([session("a")]);
  for (let turnIndex = 0; turnIndex < 12; turnIndex += 1) {
    say("a", "user", `Ask ${turnIndex}`);
    note(`n${turnIndex}a`, `Note ${turnIndex} one\nsecond line`);
    note(`n${turnIndex}b`, `Note ${turnIndex} two\nsecond line`);
    say("a", "assistant", `Answer ${turnIndex}\nsecond line\nthird line`);
  }
  await openChat(page);
  await turnWith(page, "Answer 11").waitFor();
  const fold = page.locator(".notes").last();
  const before = (await fold.boundingBox()).y;
  await fold.click();
  await turnWith(page, "Note 11 one").waitFor();
  const opened = page.locator(".notes").last();
  assert.ok(Math.abs((await opened.boundingBox()).y - before) < 2, "the fold stays under the finger");
  assert.equal(await opened.evaluate((el) => el === document.activeElement), true);
  // The first loaded item can be a folded note; the view must not jump when earlier messages arrive.
  await scrollTo(page, 0);
  const reading = page.locator(".turn").first();
  const text = await reading.locator(".turn-body").textContent();
  // The body, not the turn: the time stamp above the first turn moves to the new first turn.
  const top = (await reading.locator(".turn-body").boundingBox()).y;
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await page.waitForFunction(() => !document.querySelector(".earlier")?.disabled);
  const same = page.locator(".turn", { hasText: text }).first().locator(".turn-body");
  assert.ok(Math.abs((await same.boundingBox()).y - top) < 4, "earlier messages keep the reading position");
});

check("a skill or file prompt shows as a folded chip with the words typed after it", async (page) => {
  reset([session("a")]);
  say("a", "user", '<skill name="review" location="/s/review/SKILL.md">\nReferences are relative to /s.\n\n# Review skill body\n</skill>\n\nfocus on the dock');
  say("a", "user", '<file name="/jobs/1/task.md">\nTask body\n</file>\n');
  await openChat(page);
  const chips = page.locator(".attach summary");
  assert.deepEqual(await chips.allTextContents(), ["/review", "@task.md"]);
  assert.equal(await page.getByText("Review skill body").isVisible(), false);
  assert.equal(await turnWith(page, "focus on the dock").locator(".pre").textContent(), "focus on the dock");
  await chips.first().click();
  assert.equal(await page.getByText("# Review skill body").isVisible(), true);
});

check("returning from a session restores the list's place, and Back steps through history", async (page) => {
  reset(Array.from({ length: 30 }, (_, index) => session(`s${index}`, { status: "running" })));
  await open(page);
  await page.getByText("Session s29").waitFor();
  await scrollTo(page, 600);
  const y = await page.evaluate(() => window.scrollY);
  await page.getByText("Session s20").click();
  await page.locator(".band-name", { hasText: "Session s20" }).waitFor();
  const entries = await page.evaluate(() => history.length);
  await page.getByLabel("Back to inbox").click();
  await page.getByText("Session s29").waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.scrollY), y);
  assert.equal(await page.evaluate(() => history.length), entries, "Back adds no history entry");
  // Opened straight from a link, Back still leads to the inbox, and never out of Hub after browser Back returns here.
  await open(page, "/#/s/s3");
  await page.locator(".band-name", { hasText: "Session s3" }).waitFor();
  await page.getByLabel("Back to inbox").click();
  await page.getByText("Session s29").waitFor();
  await page.goBack();
  await page.locator(".band-name", { hasText: "Session s3" }).waitFor();
  await page.getByLabel("Back to inbox").click();
  await page.getByText("Session s29").waitFor();
  assert.equal(new URL(page.url()).origin, base);
});

// ---- run ----

const filter = process.argv[2];
let failed = 0;
for (const { name, fn } of checks) {
  if (filter && !name.includes(filter)) continue;
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await fn(page);
    assert.deepEqual(errors, [], "page errors");
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    // A script error in the page explains a timeout better than the timeout does.
    const cause = errors.length ? `page error: ${errors.join("; ")}` : String(error.message).split("\n").slice(0, 6).join("\n  ");
    console.log(`FAIL - ${name}\n  ${cause}`);
  }
  await context.close();
}
await browser.close();
await web.close();
proxy.close();
for (const pair of pairs) pair.client.destroy();
console.log(failed ? `${failed} failed` : "all web checks passed");
process.exit(failed ? 1 : 0);
