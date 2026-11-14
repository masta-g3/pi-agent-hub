**Feature:** skill-reply-001 → Skill replies
**Session:** 01a1ce61-d251-71b6-a431-7d8fb5628d9f
**Worktree:** `/Users/manager/.local/share/agent-worktrees/skill-reply-001-638a56ad4468/pi-agent-hub`, branch `skill-reply-001` (record `…/skill-reply-001-638a56ad4468/worktree.json`)
**Start branch:** `main`
**PR target:** `main`

# skill-reply-001 · Skill replies

Mock: `agent-work/decks/skill-replies.html` (screens 1 and 2). Ticket 2 (`skill-reply-002`, Skills library) reuses this ticket's skill list.

The user mostly replies to agents with workflow skills (`/plan-md`, `/execute`, `/review`, …). Today the card Reply (`p`) sends text only. Pi's skill command is `/skill:<name>`. The user types `/review`, which is short for it.

```text
p on a card whose workflow step is complete:

REPLY · Subagent lens · Send
┌──────────────────────────────────────┐
│ message, or / for a skill            │
└──────────────────────────────────────┘
 plan-md  execute  review [reflect] commit
 ←/→ step · Enter send /reflect · Esc keep draft

typing "/re":
┌──────────────────────────────────────┐
│ /re                                  │
└──────────────────────────────────────┘
▌/review   Review finished work before reflection and commit.
 /reflect  Reflect on reviewed work and update durable docs …
 ↑↓ choose · Tab complete · Enter send

> on the card (no Reply): sends /skill:reflect at once.
```

## Confirmed decisions

- **Source of skills: the agent itself.** The Hub extension adds the session's loaded skills (`pi.getCommands()`, `source: "skill"`) to the existing interaction `state` reply: name, description, at most 48 skills. A skill is left out when an extension command uses the same name (`skill:<name>`), because Pi runs extension commands first. Every name in the list works in that session. Hub reads no skill files for this ticket.
- **Typed form.** The user types `/name` or `/skill:name`. On send, Hub rewrites a leading `/name` to `/skill:name` only when `name` is in the session's skill list. Other text is sent unchanged.
- **Busy delivery.** Pi expands skills in steered and queued messages only when the extension passes `expandPromptTemplates: true`. Hub keeps busy messages literal today so `/commands` cannot jump the queue. For Steer and Queue, the extension sets `expandPromptTemplates: true` only when the text starts with `/skill:<name>`, live `getCommands()` at send time lists `skill:<name>` as a skill, and no extension command has that name. Pi checks extension commands before skills (`agent-session.js:1704`), and extensions may register a command named `skill:<name>`, so this check stops a busy message from running a command. Other busy text stays literal.
- **Workflow-step chips.** When the selected session reports a workflow (`session.workflow`) and its step ids are loaded skills, Reply shows those steps as chips. The next step is picked: the step after the active one when `currentStepComplete` is true, otherwise the active step. `←`/`→` move the pick while the input is empty and delivery focus is off; with delivery focus on (Steer/Queue), `←`/`→` keep switching delivery as now. Enter on an empty input sends the picked step. Typing hides the pick, and Enter sends the typed text. No workflow, or no matching skills: no chips. Hub stores nothing new.
- **`>` key: next step.** A new card action `next-skill` (key `>`, label `Next: /reflect`) sends the next step's skill. It is available only when that step is a loaded skill, the step is complete, and the session is idle (same guard as Reply `send`). It is an `actionSpecs` entry in `dashboard-commands.ts`. Help lists it by its static base label `Next skill`. The selected-session label `Next: /reflect` appears through the existing selectors: `selectWorkspaceCommands()` for card actions and `dashboardFooter()` for the footer. `>` is added to `RESERVED_DASHBOARD_KEYS` so a configured shortcut cannot take it.
- Recent-skill chips are dropped: the user cycles through workflow skills, and the step chips cover that.

## Context files

**Core**
- `src/core/session-interaction.ts`: `SessionInteractionState` (+ `skills`), parse/validation.
- `src/extension/session-interaction.ts`: adapter `getSkills()`, `state` reply, `send-message` expansion rule.
- `src/extension/index.ts`: wire `getSkills` from `pi.getCommands()`.
- `src/tui/sessions-view.ts`: `ReplyDraft`, `startReply`, `updateReplyPanel`, `handleReplyInput`, `submitReply`; `>` handler.
- `src/tui/dashboard-commands.ts`: `next-skill` action spec and availability; `selectWorkspaceCommands()` and `dashboardFooter()` selectors.
- `src/core/dashboard-shortcuts.ts`: reserve `>`.
- New `src/core/skill-reply.ts`: pure helpers (completion matches, rewrite, next step, chips).

**Reference**
- `test/inbox-reply.test.ts`: Reply flows and the real-socket test.
- `test/session-interaction.test.ts`: `state` envelope and caps.
- `src/core/heartbeat.ts`: `WorkflowRuntimeSnapshot` (`steps`, `activeIndex`, `currentStepComplete`).
- Pi docs `extensions.md`: `pi.getCommands()`, `sendUserMessage` options; Pi `_expandSkillCommand`.

## Reuse

- The interaction bridge `state` request already returns live per-session data (`messageDelivery`, `lastMessage`) under a 256 KiB cap. Skills ride on it; there is no new request kind or file.
- The Reply card panel, `TextInputState`, and `writeInteraction` receipts stay as they are. Chips and the completion list are body lines in the same panel.
- The catalog `ActionSpec` pattern gives `>` its Help, palette and footer entries.
- `session.workflow` from the heartbeat gives the steps and the next step. No new producer data.
- New `src/core/skill-reply.ts`: the matching, rewrite and next-step logic is pure and is shared by the view and ticket 2. A separate module keeps `sessions-view.ts` from growing more.

## Design

### Data

```ts
// src/core/session-interaction.ts
export interface SessionSkill { name: string; description?: string }
export const SKILL_LIST_MAX = 48, SKILL_DESCRIPTION_CHARS = 160;
SessionInteractionState.skills?: SessionSkill[]
```

Extension: `getCommands: () => pi.getCommands()` on the adapter. The `state` reply keeps skills whose `skill:<name>` has no extension command with that name, capped and trimmed.

Budget order in `state`: pending questions first, as now. Then whole skill entries are added while they fit the serialized-envelope budget that is left; entries that don't fit are dropped, never cut short. Then option previews, then `lastMessage`, as now. A near-cap questionnaire therefore drops skills instead of failing the whole reply.

### Pure helpers (`src/core/skill-reply.ts`)

```ts
skillMatches(input: string, skills): SessionSkill[]   // input "/re" or "/skill:re", no space yet; prefix matches first, then substring; max 6
toSkillCommand(text: string, skills): string          // "/review x" -> "/skill:review x" when review is loaded
workflowSkillSteps(workflow, skills): { ids: string[]; next?: number } | undefined
nextSkill(workflow, skills): string | undefined       // only when currentStepComplete and the next step is a loaded skill
```

### Reply panel

`ReplyDraft` gains `pick?: number` (chip index) and `match?: number` (completion index); both are view state only.

- Body: header line, input, then either the completion list (when matches exist) or the chip line (when chips exist and the input is empty), then the existing delivery lines.
- Keys: delivery focus (Steer/Queue) keeps priority: while it is on, keys work as now and no completion or pick moves. With input focus: completion open: `↑`/`↓` choose, `Tab` or `Enter` completes to `/name `. Input empty with chips: `←`/`→` move the pick, `Enter` sends `/skill:<picked>`. Otherwise the keys work as now. `Tab` still toggles delivery focus when no completion is open.
- Key line: shows the active hints in the same reserved line (`↑↓ choose · Tab complete` or `←/→ step · Enter send /reflect`).
- Narrow widths: chips stay on one line and drop from the left past the pick; at 30 columns only the picked chip shows. Completion lines truncate descriptions first. The busy delivery hints and key rows keep their reserved lines at every width; chips and completions use only the body lines above them.
- Styling: skill names use the theme accent through existing `layout.ts`/theme helpers; there are no new colors.

### `>` action

`next-skill` in `actionSpecs`: base label `Next skill` (Help); selected label `Next: /<id>` in card actions and footer. `available` checks a live interaction target, idle `messageDelivery`, and `nextSkill(...)`, and gives a reason otherwise. All paths (key, palette, card action, footer tap) use this one guard. The handler sends `/skill:<id>` through the same `writeInteraction` path and receipt as Reply.

## Implementation Phases

### Phase 1: Skills in the interaction state
- [ ] Test (`test/session-interaction.test.ts`): `state` returns `skills` from the adapter, capped at 48 and descriptions at 160 chars; a skill shadowed by an extension command `skill:<name>` is left out; invalid skill entries fail parse; a near-cap questionnaire drops skills and the reply still succeeds; `lastMessage` budget still holds.
- [ ] Add `SessionSkill`, caps, parse rule; adapter `getCommands()`; budget order; wire in `src/extension/index.ts` from `pi.getCommands()`.
- [ ] Test the real socket (`test/inbox-reply.test.ts`): busy `/skill:review x` for a loaded skill → `expandPromptTemplates: true` with `deliverAs`; busy `/skill:unknown`, `/template`, and `/skill:shadow` (an extension command named `skill:shadow` also exists) stay literal; idle unchanged.
- [ ] Implement the `send-message` rule.
- [ ] `npm run typecheck`, focused tests.

### Phase 2: Pure helpers
- [ ] Tests for `skillMatches`, `toSkillCommand`, `workflowSkillSteps`, `nextSkill`: prefix order, `/skill:` input, spaces stop completion, unknown names untouched, no workflow, step ids not loaded, incomplete step (active step picked, no `>`), last step complete (no next).
- [ ] Implement `src/core/skill-reply.ts`.

### Phase 3: Reply autocomplete and chips
- [ ] Tests (`test/inbox-reply.test.ts`): `/re` shows matches with descriptions; `↓`+`Tab` completes `/reflect `; Enter sends `/skill:reflect extra`; chips render with the next step picked; `←` moves the pick; Enter on empty sends `/skill:<pick>`; typing hides the pick; with delivery focus on, `←`/`→` switch Steer/Queue and the pick stays; no workflow → no chips; Esc keeps the draft; widths 160/80/60/30 fit (`visibleWidth`) and busy delivery hints stay visible.
- [ ] Implement the draft state, body, keys and key line in `sessions-view.ts`; apply `toSkillCommand` in `submitReply`.

### Phase 4: `>` next step
- [ ] Tests: `>` sends `/skill:reflect` when step complete and idle; disabled (with reason) when busy, incomplete, no workflow, or step not a skill, through key and palette alike; Help shows static `Next skill` with `>`; card actions and footer show `Next: /reflect` where room exists; a configured shortcut on `>` is rejected.
- [ ] Add the `next-skill` spec, handler, selector entries, and reserve `>` in `src/core/dashboard-shortcuts.ts`.

### Phase 5: Docs and full checks
- [ ] `docs/FEATURES.md` (Reply, keys table), `docs/STRUCTURE.md` (interaction state `skills`, send rule), `CHANGELOG.md`.
- [ ] Real Pi check: managed session with Rules skills; `/` lists them; `>` sends a step; capture to `agent-work/tickets/skill-reply-001/validation.md`.
- [ ] `npm test`, then `npm run package:check` (not concurrently); `git diff --check`.

## Acceptance Criteria

- [ ] Typing `/` in Reply lists the selected session's loaded skills with descriptions; typing filters; `Tab` completes. (Phase 3 test)
- [ ] A reply that starts with `/name` for a loaded skill reaches Pi as `/skill:name …` and runs the skill, when idle and when steered or queued. (Phase 1 socket test, Phase 3 test, real Pi check)
- [ ] Other `/` text keeps today's behavior: idle expands, busy stays literal. (Phase 1 socket test)
- [ ] With a workflow whose steps are skills, Reply shows the steps as chips with the next step picked; Enter on an empty input sends it; `←`/`→` change it. Without one, no chips. (Phase 3 tests)
- [ ] `>` sends the next step's skill only when the step is complete, the next step is a loaded skill, and the session is idle; otherwise it explains why. (Phase 4 tests)
- [ ] Reply fits at 160, 80, 60 and 30 columns without breaking the existing delivery controls. (Phase 3 width tests)
- [ ] Hub stores no new state and reads no conversations or skill files. (Code review; no new persistence)
- [ ] `npm test` and `npm run package:check` pass.

## Reflection Candidates

- `AGENTS.md` dashboard rules: `>` is a new established key; Reply skill completion and chips.
- `docs/STRUCTURE.md`: interaction `state.skills` and the busy `/skill:` expansion rule.

## Discovered Work

None.
