**Feature:** cockpit-014 → Explicit handoffs
**Session:** 01a133f2-09b6-70d9-b579-6b61e2e10382
**Worktree:** none (in place on `main` in `rules` and `pi-agent-hub`)

## Outcome

The working agent now declares handoffs itself. A Rules tool, `hand_off`, publishes `ready` or
`blocked` attention with an optional recommendation and an optional evidence artifact. It
replaces the post-turn model call that guessed attention. Hub shows the new fields and copies
the evidence path.

## Decisions

- **Replace guessing.** Rules removed `ATTENTION_PROMPT`, the model-output parser,
  `attentionInput`, `latestUserRequest`, and the `agent_end` attention call. Metadata model calls
  now cover session naming only.
- **The tool lives in Rules** `workflow-runtime`, the single producer of `pi-agent-hub-context`.
- **Contract:**
  - `text` ≤ 150 characters.
  - `recommendation` ≤ 150 characters, normalized like `text`.
  - `artifact` ≤ 1,024 characters, validated raw: trimmed, internal whitespace kept, C0/C1/DEL
    rejected.
  - Rules requires a relative artifact path to exist and publishes it as an absolute path.
    `http(s)` URLs pass through.
  - The request ID is `sha256(toolCallId)`, so explicit handoffs reach Hub's existing
    fresh-request delivery.
- **Focus mode:** `hand_off` ends active focus (`ready` → completed, `blocked` → blocked), because
  a continuation turn would clear the handoff.
- **Lifecycle unchanged:** a handoff clears on the next `before_agent_start`, survives resume,
  and a later call replaces an earlier one.
- **No Open action:** opening files would need per-platform code. Hub shows and copies the path
  with the existing best-effort `pbcopy` callback, so copying works on macOS only. Hub never
  reads the artifact.
- **Hub parsing:** a malformed optional field is dropped without hiding the request.
  Older producers are unaffected.

## Implementation notes

- **Rules:**
  - `session-context.ts`: `rawArtifact` and `handOffAttention`. `parseContextSnapshot` accepts the
    new fields.
  - `index.ts`: the `hand_off` tool, and `agent_end` simplified to focus continuation only.
- **Hub:**
  - `SessionAttention` gains `recommendation` and `artifact`.
  - `parseAttention` adds isolated optional parsing and a local raw artifact check.
  - The workspace request block adds `→` recommendation and `▤` artifact rows, with the artifact
    left-truncated through the existing `truncateValue(..., "start")`.
  - Catalog `copy-path` (`y`) is available for waiting/idle sessions with an artifact plus the
    copy capability. Its command ID carries the encoded request ID, so the existing
    `executeDashboardCommand` exact-ID guard rejects stale clicks.
  - The workspace shows at most three actions, so Copy path takes the third slot, and Mark read
    stays on `a` and `:`.
- **Folded in during reflection (user-approved):** configured dashboard shortcuts could claim `F`
  (Fork and compact) and `S` (board) and were silently shadowed. Both are now reserved. A test
  asserts that every built-in catalog key is rejected as a configured shortcut.

## Verification

- Rules `uv run pytest -q`: 87 passed.
- Hub `npm run typecheck`: clean. `npm test`: 1,097 passed.
- Smoke on an isolated tmux server with temporary agent/Hub state and a real model:
  - `hand_off` published the request ID, the recommendation, and an absolute artifact that kept
    a double space.
  - Hub showed `✓` in NEEDS YOU with the `→`/`▤` rows, and `y` copied the exact path.
  - A new turn cleared the handoff.
  - A `blocked` handoff raised the `! BLOCKED` notification band.
  - `/session-metadata-status` showed naming only.

## Reflection outcomes

- `docs/STRUCTURE.md`: handoff rows and the copy-path ID are documented. Stale claims about
  answering and conversation rendering are corrected.
- `docs/DEVELOPMENT.md`: run lifecycle CLI commands from inside the isolated tmux socket.
  During smoke testing, `pi-hub add` run outside the socket created one temporary session on the
  default server; it was removed.
- Shared workflow skills do not mention `hand_off` yet (user decision): watch real use first.
