# web-004 · Phone chat polish

## Outcome

The phone session screen reads as a chat, the list fixes its bugs, the working line shows live work, and question cards answer every question from the list.

- **Chat:** your messages are right-hand bubbles; agent messages run full width. Role names are for screen readers only, except Question, Your answer and unknown kinds. Times show as centered stamps.
- **Prompts:** `splitPrompt()` in `web/chat.js` folds Pi's exact `<skill name=… location=…>` and `@file` (`<file name=…>`) expansions into named chips (`/review`, `@task.md`). Ambiguous text, such as typed text that mentions `</file>`, stays as typed.
- **Header:** back arrow, title, one status line (`Working · Execute 2/5 · ↳1`), and a coloured connection dot. The intro block and step strip are gone; a small line opens the transcript with ticket, subtitle and group.
- **Dock:** a one-row composer (box + Send, or Queue + Steer); Mark read is a chip above it; reply, answer and note fields set `autocomplete="off"` so iOS offers no contact AutoFill.
- **Working line:** the live tool, else **Thinking**; `N tools · 2m` at the right; one flash per new call; the run time ticks each second.
- **Interim messages:** an agent message written on the way to a tool call (`ConversationItem.interim`) is smaller and muted.
- **List:** request titles wrap; working rows show the live tool or Thinking on one line, never an old note; returning from a session restores the list position; Back steps through history only from an entry a list tap created (`history.state.fromList`).
- **List answer stepper:** one question at a time with progress dots; a single choice advances; multi-select uses Next; typed answers keep focus through live rebuilds; Send comes after the last question. It shares form state with the chat, shows conditions and context, and appears only when exactly one questionnaire is pending, because Send also dismisses the card's request.

## Data

- Extension: `activity.calls` counts tool calls per agent run, reset on `agent_start`. Parser accepts a positive integer up to 1,000,000.
- Inbox: `work: { tool?, calls?, since? }` only while running; `since` is the heartbeat `stateSince` of the running state.
- The count and interim marks need a session started or reloaded with this version.

## Verification

- `npm test` 1712 pass; `npm run test:web` 31 pass; `tsc` clean.
- Live screenshots were checked in Chrome and WebKit (390×844, dark and light); the demo-data stepper screenshots are in `agent-work/tickets/web-004/`.
- `code-critic`: 5 passes; fixed file-chip text loss (twice), Back leaving Hub, missing run timer, stepper conditions, and the multi-questionnaire dismissal. Final LGTM.
- Installed globally and restarted `pi-hub web`; live at the Tailscale address.

## Follow-up

- None. `AGENTS.md` heartbeat `activity` sentence names the count.
