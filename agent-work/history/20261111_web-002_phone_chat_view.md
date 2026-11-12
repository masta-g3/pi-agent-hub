# web-002 · Phone chat view

## Outcome

The session screen of the phone inbox (`pi-hub web`) is a live chat transcript. The inbox list, push notifications, access model and terminal dashboard did not change.

- **Live messages:** finished messages appear within about 3 s while the screen is open. While the agent works, one line shows what it is doing. Text is not streamed word by word.
- **Layout:** full-width turns under a role label (`YOU`, `AGENT`, `QUESTION`, `ANSWER`). An unknown kind shows as plain text under its own name. A time shows only after a pause of 5 min or more.
- **Your turns:** they have a tinted background and an accent rule. Plates and stripes stay on the pending request block only.
- **Markdown:** agent messages render headings, emphasis, strikethrough, code, fenced code with a language label, nested lists, quotes, tables and rules. What a person typed is shown as typed.
- **Links and images:** only absolute `http`, `https` and `mailto` targets without a login part become links. Images show as links. Raw HTML is text.
- **Scrolling:**
  - The view follows new messages at the end.
  - A reader who has scrolled up keeps their place and sees a `New messages ↓` pill.
  - A new message taller than the screen is shown from its first line.
  - `Earlier messages` prepends a page (up to 20) and keeps the reading position. `Start of conversation` replaces it at the top.
- **Sent replies:** a reply shows at once as a local `YOU` turn, marked `Sending…`, then `Sent`, `Queued` or `Delivery unknown`. Pi's own record replaces it. A slash command shows only its receipt. A rejected reply leaves no turn and keeps the draft.
- **Pending question:** it appears once, as the answer form.
- **Header and dock:** the band holds `‹ Inbox`, a one-line title, the connection state and the step readout. The dock holds the receipt, a reply box that grows to six lines or 30 dvh, Mark read on the left and Send (or Queue and Steer) on the right.
- **Out of scope:** streaming, tool output, diffs, thinking, images, attachments, syntax colors and subagent transcripts. The data shape keeps room for them.

## Decisions

- **Data source:** the existing live-branch `read` interaction request. It returns the newest page, and earlier pages through a cursor. There is no extension change and no `/reload`, except for message times.
- **Message times:** `ConversationItem.at` holds the time Pi recorded the message, in epoch milliseconds. Extensions without it send no times.
- **Merge:** `web/chat.js` follows `ConversationTranscriptPanel.accept()`:
  - items are matched by ID, and a changed item replaces the old one;
  - a page that shares no item with the transcript replaces it, or waits while the reader is scrolled up;
  - a gap is never spliced in;
  - there is no shortcut on `revision`, because it hashes the whole branch.
- **Requests:**
  - One detail read at a time, every 1.5 s.
  - `write()` invalidates a read that is already in flight.
  - An earlier page is applied only to the session, branch and cursor it was requested for.
- **Settling local replies:** `settleSent` uses only the items appended in that poll. It retires the reply with the same text first, then the oldest reply sent to an idle agent, because Pi may expand that text.
- **Markdown renderer:** written in-house in `web/markdown.js`, with no dependency.
  - The parser returns plain data, and the renderer builds DOM nodes through `h()`.
  - Every scan is linear.
  - Quotes and lists nest at most 8 levels, and emphasis at most 32.
  - Every newline inside a paragraph is kept, as in the dashboard.
- **Server:**
  - `GET /api/sessions/:id/conversation?before=&branch=` reads an earlier page. Both parameters are required and capped at 256 characters.
  - A moved branch or cursor returns 409; any other read failure, or a session that cannot be reached, returns 503.
  - The detail response returns a conversation page and no longer carries `lastMessage`.
- **Browser check:** `npm run test:web` runs `scripts/web-check.mjs` and adds no dependency.
  - It uses Playwright from `PLAYWRIGHT_PATH`, then the repository's `node_modules`, then Pi's package directory, with the installed Chrome or `PLAYWRIGHT_CHROME`.
  - It warns and exits 0 when either is missing.
  - It is not part of `npm test`.

## Code

- New:
  - `web/markdown.js`, `web/chat.js`;
  - `scripts/web-check.mjs`, with 25 checks over an in-memory fleet at 390 × 844;
  - `test/web-markdown.test.ts`, `test/web-chat.test.ts`.
- Changed:
  - `web/app.js`: transcript, polling, local turns, scroll, band and dock. The `SAID` block and the `Recent messages` list were removed.
  - `web/app.css`: transcript and Markdown styles, and the tokens `--you-wash`, `--lh-prose`, `--lh-code`, `--measure`, `--rule-w` and `--composer-max`.
  - `src/web/server.ts`, `src/web/run-web.ts`;
  - `src/core/conversation.ts`, `src/core/session-interaction.ts`;
  - the `test:web` script in `package.json`.
- Docs: `FEATURES.md` (Chat), `STRUCTURE.md` (transcript source, merge parity, Markdown safety), `DEVELOPMENT.md` (Phone inbox checks) and `CHANGELOG.md`.

## Verification

- **Tests:** `npm test` passes 1687, against 1657 at baseline. `npm run package:check` passes and ships both new page files. `npm run test:web` passes 25 checks. With no Playwright or no browser it warns and exits 0, and a failing check exits 1.
- **Hostile and random input:** the Markdown tests include hostile 64 KB inputs under 200 ms, the U+2028 and U+2029 cases, and 20,000 random inputs with no unsafe link.
- **Real messages:** in review, 544 real agent messages and 300,000 random inputs rendered without a throw. Only safe attributes were set.
- **Live inbox:** three real sessions rendered 12 to 80 turns with no sideways scroll and no page errors, and earlier pages loaded.
- **Review fixes:**
  - a retry after an unknown delivery showed twice;
  - a quadratic regex stalled on U+2028;
  - a history cursor was lost for a session opened while empty;
  - a failed earlier-page read discarded the loaded history;
  - links with a login part were clickable.
  - The second critic pass was clean.
- **Not done:** the user's iPhone check was not done before commit.

## Follow-up

- `web-003` Transcript merge parity: one test feeds the same pages to both transcript merges.
- **Declined:** widening the `AGENTS.md` concurrent-build rule to cover other sessions; a Rules ticket for the `code-critic` model fallback, unless the problem happens again.
