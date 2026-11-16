# web-006 · Fold agent notes

## Outcome

The phone chat folds each run of agent notes written on the way to tool calls (`interim` items) into one quiet line of muted italic text, such as `4 notes ›`. Tapping it replaces the line with the notes; it does not stay as a header. The reply that ends the turn stays open at full size. While the agent works, its newest note stays visible under `N earlier notes ›`. Open folds persist for the open screen only (`state.chat.openNotes`).

## Decisions

- Page only: `web/app.js` and `web/app.css`. No server or transcript-merge change; the dashboard Conversation view is unchanged.
- The fold line is text, not a pill, so it never reads as a reply bubble. Opening puts the first note where the line was, moves focus to it, and pauses following until the reader returns to the end.
- A folded item has no element, so new-message reveal goes through its fold (`body.hubFolds`), and loading earlier messages anchors the first visible message.
- Sessions started before web-004 have no `interim` marks, so their notes stay unfolded.

## Verification

- `npm run test:web`: 37 pass, including 2 new checks (fold, live note and per-turn state; position, focus and earlier-page anchor). `npm test`: 1793 pass.
- code-critic: 2 passes, the last with no issues.
- Installed globally from feature-only staging; the live page serves the new `app.js`.
