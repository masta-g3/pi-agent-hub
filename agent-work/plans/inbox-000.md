# Inbox-first dashboard epic

Goal: Supervise and reply to agents from the no-pin session list, so opening a session becomes the exception.

## Acceptance criteria

- Every Active card shows what the session is about, where it is, and what it needs, without opening Pi.
- Any waiting live parent session can get a typed reply, steer, or queued message from its card; subagents and unsupported prompts offer Open in Pi.
- Stock rpiv-ask-user-question 2.15+ questions can be answered from the card, and the verdict stays visible there.
- Managed agents use ask_user_question and hand_off with context and a recommendation instead of plain chat requests.
- No retired path remains beside its replacement.

## Decisions

- Inbox-first: the no-pin fleet is the primary way to work; pins and follow view stay for hands-on work.
- Follow view is off by default.
- Card text comes from producer metadata only: ticket subtitle, workflow position, and the explicit request with its recommendation and evidence. No model summaries, pane tails, or conversation search.
- Structured answers use rpiv's official answer events; the Hub fork protocol and tarball instructions are retired.
- Replace, do not duplicate: the card composer replaces the Send text dialog, card answering replaces Conversation's answer area, and Conversation becomes read-only history.
- One card shell: inbox-003 owns card expansion, focus, the decision strip, and narrow geometry; 004 and 005 reuse it.
- Feedback closes the loop: Submitting, Accepted, Rejected, or Delivery unknown stays on the card; uncertain delivery never retries silently.
- Selecting, reading, or acknowledging a handoff never counts as approval.
- The Hub extension injects the agent note through the existing system-prompt hook.
- inbox-002's approved deck is the visual reference for 003–005: `agent-work/decks/inbox-design-lab.html`, Frozen decisions D1–D10; rationale and real-data lengths in `agent-work/history/20261028_inbox-002_inbox_design_lab.md`.
- Preview text for the selected option comes from the exact pending `ask_user_question` tool call in the live branch (Conversation's typed source), guarded by interaction instance, branch, and toolCallId; never persisted, searched, or read from session files.

## Test seams

- Dashboard render-model and fleet-card tests for card content and states.
- Dashboard command catalog tests for the availability and targeting of reply and answer actions.
- Extension and interaction-response tests for the rpiv event contract and the system note.

## Tickets

- `inbox-001` Official answer protocol: works when a stock rpiv 2.15+ question is answered from Hub, the fork code and tarball docs are gone, and stale, raced, restarted, and unconfirmed cases are handled.
- `inbox-002` Inbox design lab: works when the maintainer approves mockups for cards, composer, questions, handoffs, and narrow widths.
- `inbox-003` Self-explaining cards: works when each Active card answers what, where, and next, and the dashboard opens without follow view.
- `inbox-004` Reply from card: works when the selected card sends, steers, or queues text inline, and the Send text dialog is gone.
- `inbox-005` Answer from card: works when card options answer a pending question and the verdict shows on the card.
- `inbox-006` Dashboard agent note: works when managed parent sessions receive the note and agents use ask/hand-off tools. Start here: it produces real requests for the design lab.
- `inbox-007` Inbox-first docs: works when the durable docs, Help, onboarding, and install guidance describe the inbox model with no retired guidance.

## Not yet specified

- One-line rows for working sessions, led by the producer activity verb.
- Making the in-session `Alt+W` next-request hint easier to discover.

## Out of scope

- A Hub-owned question tool: rpiv now provides the official channel.
- Model-generated summaries: they cost tokens and can be wrong.
- Answering questions inside `/lanes` child buses: rpiv cannot reach them from the parent.
