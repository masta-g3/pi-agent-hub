# usage-001 — Usage dashboard

## Outcome

Implemented and reviewed account quota bars plus a full-screen Usage view with Cost, Tokens, and Limits. Hub consumes producer-neutral rollups; it does not index conversations, read credentials, fetch quota endpoints, or maintain a price table.

- Branch: `usage-001`; PR target: `main`.
- Worktree: `/Users/manager/.local/share/agent-worktrees/usage-001-cdd02db9d2c7/pi-agent-hub`.
- Rules record: `/Users/manager/.local/share/agent-worktrees/usage-001-cdd02db9d2c7/worktree.json`.
- Companion producer: https://github.com/masta-g3/pi-accounts/pull/1.
- Closeout: retain the worktree pending PR merge and explicit cleanup approval. Never build or install into the user's linked checkout for this ticket.

## Implemented contract and ownership

- Producers atomically publish version-1 `usage/*.json` files under Hub state. Accounts and history validate independently; displayed text is sanitized and bounded. File/row caps, numeric/date/time-zone checks, null pricing, and unknown-field tolerance protect the reader.
- `src/core/usage.ts` owns mtime/size-gated reads, account deduplication by producer + ID, history deduplication by indexed source, compatible-time-zone merging, period totals, breakdowns, chart buckets, cache metrics, and pace calculations.
- The existing controller refresh tick exposes usage only in memory. Registry, heartbeats, and UI state contain no usage data.
- `src/tui/usage-view.ts` owns the pure renderer, normalized transient view state, quota fitting, patterns, and chart rounding. Existing command catalog, `SessionDialog`, mouse routing, glyphs/themes, render model, and both header paths are reused.
- Cost estimates remain separate from recorded cost; unpriced models retain tokens. Projects use producer daily totals. No npm dependencies were added.

## User decisions and reversible choices

- User chose a producer-neutral JSON contract, not a plugin loader or package dependency.
- `u` opens Usage; header quotas open Limits. Quotas use only space left after the existing mode and owner signals; tier-chip positions remain unchanged. No account snapshot leaves the header unchanged.
- Tab, period, cursor, breakdown, selection, and scroll are process-local. Account labels omit emails.
- Adopted designer refinements: even-pace mark `┃`; chart cursor readout as legend; distinct patterns with neutral theme roles; whole-cell largest-remainder stacking; Limits without provider headings.
- Projects are unavailable at 24h. History uses hourly buckets for 24h, daily buckets for 7d/30d/90d, and weekly buckets for All. Tall Tokens views include weekday activity and streak.
- Narrow layouts omit redundant chart labels before losing selected breakdown rows, reserve actual axis-label width, compact row details, and drop whole footer controls while retaining Close. Rendering supports 30–200 columns, NO_COLOR, and ASCII glyphs.

## Review and reflection

- Added regression coverage for parsing/caps, safe strings and provider keys, caching/non-persistence, source time zones, null pricing, header priority/hit ranges, dialog controls, chart rounding/cursor, Limits scrolling, and terminal modes.
- Accepted code-critic's hourly aggregation performance finding: reuse one date formatter and convert only distinct active hours. A 10,000-row regression checks local-day correctness and bounded formatter construction.
- Real producer data exposed provider identities being replaced by the chart's Other label. Model rows now retain actual provider names while keeping the appropriate chart pattern; regression coverage includes a fourth provider.
- Code-critic pass 2 returned LGTM. Docs-critic approved the two concise Usage bullets added to `AGENTS.md`.
- Updated CONFIG (canonical contract), FEATURES, STRUCTURE, README, CHANGELOG, and local agent guidance. No scope expansion, new dependencies, or fallback integrations were introduced.

## Validation and retained evidence

- `npm run typecheck`: passed.
- `npm test`: **1,539 passed, 0 failed**.
- `npm run package:check`: passed, sequentially after tests.
- `git diff --check`: passed.
- Fixture captures exercise dashboard quotas and all tabs at 160×48 and 80×24, plus the Tokens activity heatmap.
- Real pi-accounts history snapshot retained all **550 daily / 266 hourly / 1,182 project rows**. Independent raw sums matched Hub totals exactly:
  - 30d: **4,046,268,848 tokens**, **$2,421.41** API-equivalent estimate, **$596.22** recorded.
  - All: **16,010,493,007 tokens**, **$14,234.81** API-equivalent estimate, **$12,244.72** recorded.
- Ten real-producer captures cover Cost and Tokens at 30d and All, each at 160 and 80 columns, plus history-only Limits at both widths. Temporary Hub/Pi state and dedicated tmux servers were removed; producer input and real Hub state remained unchanged.
- Retain `agent-work/decks/usage-001-proposal.html` for design review, `agent-work/tickets/usage-001/validation.md` for terminal evidence and input hash, and `usage-cost-160.png` for inline PR viewing of the exact text capture. The PNG does not preserve ANSI colors.
- Ignored `dist/` and `node_modules/` are local build/dependency artifacts, not shipped evidence; they can be disposed during later approved worktree cleanup.

## Discovered Work

Deferred by user direction: built-in shortcut reservations are duplicated between `src/tui/dashboard-commands.ts` and `src/core/dashboard-shortcuts.ts`. Adding `u` required both; a mismatch lets configured shortcuts claim a built-in key. The existing catalog-wide conflict test caught it. A later cleanup can centralize the source while retaining that check. No matching ticket was found in the focused backlog search; no follow-up ticket was created or updated. This archive is the source record. Do not absorb the cleanup into usage-001.

## Reflection outcomes

- Resolved: concise AGENTS guidance for Usage controls, header priority, and the producer-neutral transient boundary, with pointers to the owning docs.
- Resolved: module ownership and header behavior documented in STRUCTURE.
- No action in this ticket: shortcut reservation duplication remains deferred as Discovered Work.
