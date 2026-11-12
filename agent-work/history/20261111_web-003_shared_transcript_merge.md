# web-003 · Shared transcript merge

## Outcome

The dashboard's Conversation view and the phone chat merge conversation pages with one function, `acceptPage()` in `src/core/transcript.ts`, so the two transcripts cannot drift apart. This replaced the planned parity test at the user's request.

- **Dashboard:** `ConversationReader` implements `Transcript`. Its `accept()` keeps the branch-change reset of `anchor` and `revealId` before the merge, calls `acceptPage()`, reveals a new message from its start, then applies the existing 1 MB cap.
- **Phone:** the server sends the compiled `dist/src/core/transcript.js` at `/transcript.js`. `web/chat.js` keeps only `settleSent`.
- **Removed:** the dashboard's own merge body; `newChat`, `clearChat`, `acceptPage` and `sameItem` from `web/chat.js`; the "keep the two in step" rule in `docs/STRUCTURE.md`.

## Decisions

- **Phone's rules win** where the two merges differed. These dashboard edge cases changed, all toward correctness:
  - a page with new IDs and no older history replaces the shown messages instead of appending to them;
  - an older page that arrives after a branch change is dropped;
  - a first page that arrives while scrolled up sets `New messages`;
  - unchanged messages keep their objects.
- **Packaging:** the existing `tsc` build compiles the module. The module imports only types and uses no Node API. `STATIC_FILES` accepts an absolute path for this one entry. There is no new dependency or build step.

## Verification

- **Unit tests:** `npm test` passes 1691, against 1687 at baseline. `test/transcript.test.ts` holds the merge tests moved from `test/web-chat.test.ts`. It also fails if the compiled module gains an import, `require`, `Buffer` or `process.`.
- **Dashboard tests:** new cases in `test/conversation-gap.test.ts` cover the replaced conversation, kept objects, and the branch-change reveal reset.
- **Package and browser:** `npm run package:check` passes and ships the compiled module. `npm run test:web` passes 25 checks.
- **Live inbox:** it served `/transcript.js` over the tailnet. A real session loaded 20 messages, then 40 with `Earlier messages`.
- **Review:** the code critic found no high-impact issues. One known harmless gap remains: with devtools open, the browser's request for `/transcript.js.map` gets a 404.
