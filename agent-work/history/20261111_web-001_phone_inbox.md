# web-001 · Phone inbox

## Outcome

`pi-hub web` serves a phone page for answering agents away from the terminal. It is a companion to the dashboard, not a second dashboard.

- **List:** requests first, then every non-archived parent session, in the Status view's tiers (NEEDS YOU, HEALTH, NEW, ACTIVE, QUIET) and order. Subagents appear only as counts. The list updates live over server-sent events.
- **Answer:** a single single-choice question shows its options on the list card. A tap selects; a separate `Send "<label>"` sends. The session screen handles multi-select, several questions, typed answers, notes and option previews.
- **Reply:** any live parent session, with Send when idle and Steer/Queue when busy. Drafts are kept per conversation. A handoff recommendation can prefill the reply but never sends on its own.
- **Mark read** clears only the request and conversation shown.
- **Receipts:** Submitting, then Accepted, Rejected or Delivery unknown. Nothing retries. A lost HTTP response counts as Delivery unknown.
- **Stale connection:** after 10 s without data the page shows Reconnecting and disables sending. It reopens a silent stream, because iOS can leave a suspended page's stream open but silent.
- **Web Push:** one notification per new request with a producer request ID, per subscribed device. Requests that existed at startup send none. Tapping a notification opens that session.
- **Not on the page:** stop, delete, archive, restart, new session, login, pane output or diffs.

## Decisions

- **Access:** the server binds `127.0.0.1` only, and `tailscale serve` publishes it to the user's own devices. Hub has no login, token or pairing.
- **Guards:**
  - Requests whose `Host` is not a loopback or `.ts.net` name are refused.
  - Each `POST` needs JSON and the exact origin for its `Host`: `http` for loopback, `https` for `.ts.net`.
  - No CORS headers are sent.
  - CSP is `default-src 'self'; frame-ancestors 'none'`.
  - The body cap is 64 KB.
- **Exact-target writes:** the page echoes the `piSessionId` and `instanceId` it displayed; answers also carry the tool-call ID. Mark read carries the displayed request ID. A mismatch is rejected (409) instead of falling back to current values.
- **Headless dashboard:** `pi-hub web` runs the same `SessionsController` refresh as the TUI, including archive pruning. Acknowledge and touch go through the shared `createRegistryMutator()`.
- **No new dependency:** push uses `node:crypto` for RFC 8291 encryption and RFC 8292 VAPID signing. State lives in `web-push.json`, holding the VAPID keys and at most 16 subscriptions.
- **Page:** plain HTML, CSS and JS in `web/`, with no framework and no build step. All tokens live in the `:root` block of `app.css`. Producer text is written only through `textContent`.

## Code

- New:
  - `src/web/inbox.ts`: pure projection over `buildDashboardProjection()` and `visibleAttention()`.
  - `src/web/server.ts`: HTTP routes, guards, SSE.
  - `src/web/push.ts`: encryption, VAPID, store, request notifier.
  - `src/web/run-web.ts`: wiring.
  - `web/*`: the page, service worker, manifest and icons.
- Changed:
  - `SessionsController.acknowledgeSession()` gained an optional `expected.piSessionId` guard.
  - `createRegistryMutator()` moved to `src/app/refresh-loop.ts`, whose `tui` parameter narrowed to `{ requestRender() }`.
  - The `web [--port N]` CLI command was added, and `package.json` `files` gained `web`.
- Docs: `FEATURES.md` (Phone inbox), `CONFIG.md` (setup and security), `STRUCTURE.md` (contract), `DEVELOPMENT.md` (browser checks), a `CONTEXT.md` term, `AGENTS.md` pruning wording, and `CHANGELOG.md`.

## Verification

- `npm test`: 1657 pass, 1635 at baseline. New tests:
  - `web-inbox` and `web-server` cover the projection, guards, exact-target writes, receipts and mark-read identity.
  - `web-push` reproduces the RFC 8291 example vector and verifies the VAPID signature.
- Temporary Playwright checks in Chromium, removed after use:
  - inline tap-then-confirm, multi-select, typed answers and notes;
  - Steer and Queue, draft and focus retention, Delivery unknown without resend;
  - no lifecycle controls, the stale banner, silent-stream resync;
  - drafts kept across in-flight sends, Mark read after a request change.
- A real managed Pi session on an isolated tmux server: a reply was accepted, a question was answered from the list card, and the request left NEEDS YOU.
- A real Chrome subscription received and decrypted a push through FCM.
- The user's iPhone over `tailscale serve`:
  - the Home Screen app works;
  - a reply was sent;
  - a test question arrived as a notification;
  - the tap opened the session and the answer returned.
- Review: the code critic found clickjacking, orphaned-subagent rows, draft loss and stale Mark read; all were fixed with tests first. The second pass was clean.

## Notes

- Running `tailscale serve --bg` before Serve was enabled on the tailnet did not register later. It had to be run again.
- Multi-select, typed answers and notes were not tried on iOS.
- Follow-up `web-002` (Phone chat view) adds a live chat transcript with Markdown rendering and a permanent browser check for `web/`.

Screenshots and the designer's direction remain in `agent-work/tickets/web-001/` as the visual reference for `web-002`.
