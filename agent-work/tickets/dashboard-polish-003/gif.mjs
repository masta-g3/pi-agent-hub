const R = process.env.ROOT + "/dist/";
const { SessionsView } = await import(R + "src/tui/sessions-view.js");
const { SessionsController } = await import(R + "src/app/controller.js");
const { interactionTarget } = await import(R + "src/app/session-interaction.js");
const { sessions } = await import(new URL("./demo.mjs", import.meta.url));
const { theme } = await import(new URL("./page.mjs", import.meta.url));
const NOW = 1_800_000_000_000;
const rows = sessions.map(s => ({ ...s, piSessionId: "pi-" + s.id, interaction: { version: 1, instanceId: "i-" + s.id } }));
const q = { toolCallId: "q1", params: { questions: [{ header: "Changelog", question: "Which changelog section wins when two releases touch the same feature?", options: [
  { label: "Newest release", description: "List the feature once, under the release that shipped it last" },
  { label: "First release", description: "Keep it where it first appeared and link later changes" } ] }] } };
const pending = new Map([["docs", [q]]]);
const registry = { version: 1, sessions: rows };
const controller = new SessionsController(registry);
controller.selectSession("panel");
const view = new SessionsView(controller, () => {}, {
  terminalRows: () => Number(process.env.H), interactionTarget, now: () => NOW,
  loadInteractionState: async t => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: pending.get(t.managedId) ?? [], messageDelivery: "idle",
    lastMessage: t.managedId === "docs" && pending.has("docs") ? "I rewrote the 1.2 changelog. Two releases touch *inline answers*; I need to know which section should own it." : t.managedId === "sched" ? "Fixed three scheduler faults; every job ran clean twice." : undefined }),
  submitAnswer: async t => { pending.delete(t.managedId);
    // A heartbeat refresh replaces the registry; do the same so the view re-projects.
    controller.registry = { ...registry, sessions: registry.sessions.map(d => d.id !== t.managedId ? d : { ...d, status: "running", lastActivityAt: NOW,
      activity: { current: { tool: "edit", detail: "CHANGELOG.md", at: NOW - 2000 } },
      context: { ...d.context, attention: undefined, progress: { done: "Kept inline answers under their first release.", updatedAt: NOW } } }) }; },
  acknowledgeSession: () => {}, sendMessage: async () => {}, attachOutsideTmux: () => {},
}, theme);
const W = Number(process.env.W);
const tick = () => new Promise(r => setTimeout(r, 20));
const frames = [];
const snap = async (hold, caption) => { await view.refreshInteraction(); await tick(); frames.push({ hold, caption, lines: view.render(W) }); };
const key = async k => { view.handleInput(k); await tick(); await tick(); };
view.render(W);
await snap(2.2, "The fleet: one line per agent; the selected agent's card on the right");
await key("]"); await snap(1.6, "] jumps to the next agent that needs you");
await key("\t"); await snap(1.8, "Tab opens its question on the card");
await key("2"); await snap(1.4, "2 picks an option");
await key("\r"); await snap(2.0, "Enter sends it; the agent gets back to work");
await key("]"); await snap(2.0, "] moves on to the next request");
process.stdout.write(JSON.stringify(frames));
