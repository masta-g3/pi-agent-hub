# Cockpit visual parity

**Feature:** cockpit-010 → Cockpit parity
**Session:** 01a035c3-86d4-7e3b-af2c-8533e911aec8
**Worktree:** none
**Completed:** 2026-08-29

## Outcome

The steady-state terminal cockpit now matches the approved hierarchy in `agent-work/decks/cockpit-design-lab.html` while preserving Hub semantics. The active surface is named, owner signals align at the right edge, hidden child requests remain visible without promotion, rich owner trees have truthful boundaries, and whole-tree selection retains exact row identity.

A maintainer can answer in one scan:

1. Which surface is active?
2. Which owner tree needs inspection, including hidden child requests?
3. Where does each visible owner tree begin and end?

## Product decisions

- Name steady-state surfaces `FLEET`, `WORKFLOW`, `PINNED FLEET`, and `WORKSPACE`.
- Reserve the complete mode label before fitting right-side signals.
- Show visible/total owner-tree counts whenever a filter is active; then fit nonzero pins, `needs you`, health, and filter context.
- Keep `NEEDS YOU` reserved for explicit waiting/idle owner attention. Child attention never promotes its owner.
- Derive hidden child requests from full-fleet explicit-attention IDs minus request rows in the current visible projection.
- Show hidden request totals as `?N child` on project tier headers and `?N` on the exact presentation owner.
- Keep Active parent-tail precedence as hidden requests, active descendants, workflow, then age. Drop age first and hidden requests last under width pressure.
- Keep Backlog and Archived on their lifecycle-specific tail ladders.
- Use `│`/`└` gutters only for rich normal project and board trees at 100+ columns. Pin, narrow, Backlog, Archived, and one-line survivors stay compact.
- Use the existing `warning` tone only for `NEEDS YOU`; other rich gutters use `border`.
- Paint every visible line in the selected owner tree with `selectedBg`, while `▌`, navigation, commands, and mouse targets retain the exact selected session.
- Preserve project/board disclosure, safe pin slots, the read-only board, workflow semantics, and bounded producer context.

## Implementation

### Render model

- Added owner and visible-owner totals for mode chrome.
- Added the unfiltered Active owner-tree total so filtered workflow headers show visible/total scope.
- Added presentation-owner `hiddenChildRequestCount` and project-tier aggregates.
- Reused `RenderModel.selected?.cockpitOwnerId`; no duplicate selected-owner state was introduced.
- Counted explicit child attention through the existing `visibleAttention()` rule without changing status, tier, ordering, acknowledgement, workflow, or lifecycle.
- Associated hidden requests only with their cockpit presentation owner, including linked-main ownership boundaries.

### Layout

- Added width-safe mode chrome and renamed the project navigator heading to `TIERS`.
- Moved `⚙︎N` into the deterministic right-tail fitter with hidden requests, workflow, and age.
- Carried owner, tier, rich-tree, section-owner, and source tree-end metadata through list windowing.
- Applied tree gutters and whole-owner selection after width fitting and height windowing.
- Omitted gutters for one-line visible survivors and kept clipped trees from claiming false endings.
- Derived the `NEEDS YOU` header cap from the same post-window rich-owner facts as its gutter.
- Preserved public row targets and exact session actions.
- Removed the unused status-summary render path discovered during review.

### Tests and fixtures

- Added model tests for nested attention, filters, reveal/expansion, owner boundaries, and semantic non-promotion.
- Added layout tests for every mode, filtered visible/total counts, tail degradation, themes, rich/compact gutters, clipping, whole-tree selection, and exact markers.
- Added SessionsView coverage for hidden-request badges clearing when request rows become visible.
- Updated deterministic 60/100/160 cockpit frames with a collapsed attentive child.
- Exercised responsive widths, short heights, project/board grouping, pin controls, keyboard and mouse targets, and full-width workspaces.

## Review corrections

- Count hidden requests from the full fleet, then subtract visible projection IDs so filtering cannot erase hidden attentive siblings.
- Attach hidden requests only to `cockpitOwnerById` to prevent double counting across linked-main boundaries.
- Reserve a consistent gutter column on normal 100+ rows.
- Remove dangling gutters and warning caps when windowing leaves no multi-line rich tree.
- Distinguish the `TIERS` navigator heading from the `FLEET` mode label.
- Show filtered project and workflow counts as visible/total even when every tree matches (`1/1`).
- Remove unused `boardStatusCounts`, `STATUS_ORDER`, and `formatStatusCounts()` code.

Final code and visual critics returned `LGTM`.

## Durable documentation

Updated:

- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`

The documentation now covers mode chrome, disclosure glyphs, hidden child-request visibility, Active-tail precedence, whole-tree selection, post-window gutters, and exact target identity. No `CONTEXT.md` or `docs/CONFIG.md` update was needed because project meaning and persisted configuration did not change.

## Verification

- `npm run typecheck` — passed.
- `npm test` — 814/814 passed.
- `git diff --check` — passed.
- Bounded debug/residue scan — clean.
- Independent functional validation — passed.
- Final code critic — `LGTM`.
- Final visual critic — `LGTM`.
- Final documentation critic — `LGTM`.

## Preserved boundaries

- No new dependency, producer field, theme token, command, persistence, or parallel renderer.
- No tmux pane capture or Pi conversation access.
- No changes to attention promotion, workflow lane selection, lifecycle classification, pin ownership, or slot safety.
- No worktree or PR branch was created.
