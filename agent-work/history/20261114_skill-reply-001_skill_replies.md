**Feature:** skill-reply-001 → Skill replies
**Worktree:** `~/.local/share/agent-worktrees/skill-reply-001-638a56ad4468/pi-agent-hub`, branch `skill-reply-001`
**Start branch / PR target:** `main`

# skill-reply-001 · Skill replies

Mock: `agent-work/decks/skill-replies.html`. Follow-up: `skill-reply-002` (Skills library) reuses this skill list.

The user replies to agents mostly with workflow skills. The card Reply now sends them in Pi's form, `/skill:<name>`.

```text
REPLY · Demo ticket · Send
█
plan-md execute review reflect [commit]
 Enter Send /commit   ←/→ Step   Esc Keep draft

/re → ▌/reflect  Reflect on reviewed work…   (Tab completes)
>   → sends /skill:reflect from the card
```

## Decisions

- **Skills come from the agent.** The Hub extension adds the session's loaded skills (`pi.getCommands()`, source `skill`) to the interaction `state` reply: at most 48, descriptions at most 160 characters. A skill shadowed by an extension command named `skill:<name>` is left out, because Pi runs extension commands first. Whole entries fit the byte budget after pending questions and before previews and `lastMessage`, so a near-cap questionnaire drops skills instead of failing. Hub stores nothing new and reads no skill files.
- **Typed form.** A leading `/name` for a loaded skill is rewritten to `/skill:name`; other text is sent as typed.
- **Busy delivery.** Steer and Queue stay literal, except `/skill:<name>` for a skill that live `getCommands()` lists at send time and no extension command shadows; that one expands in the chosen queue.
- **Workflow chips.** When every workflow step id is a loaded skill, an empty Reply shows the steps with the next one picked (after a completed step, else the current step). `←`/`→` move the pick unless delivery has focus; Enter sends it. With chips, a ready handoff's draft starts empty and its recommendation stays above the editor. Recent-skill chips were dropped: the user cycles through workflow skills.
- **`>` Next skill.** A catalog action (`next-skill`, Help label `Next skill`, card label `Next: /<step>`) sends the next step's skill when the step is complete, that step is a loaded skill, and Pi is idle; otherwise it gives the reason. `>` is reserved from configured shortcuts.

## Implemented

- `src/core/session-interaction.ts`: `SessionSkill`, caps, `skills` validation.
- `src/extension/session-interaction.ts` and `index.ts`: `getCommands` adapter, `loadedSkills`, budget order, busy `/skill:` rule.
- New `src/core/skill-reply.ts`: `skillMatches`, `toSkillCommand`, `workflowSkillSteps`, `nextSkill`.
- `src/tui/sessions-view.ts`: Reply completion, chips, key hints that follow the key precedence, `sendNextSkill`.
- `src/tui/dashboard-commands.ts`: `next-skill` spec, guard and card placement; `src/core/dashboard-shortcuts.ts` reserves `>`.
- `src/tui/render-model.ts`, `layout.ts`: `clipRows` keeps completion and chip rows to one line, offset with the card's prepended rows.
- Docs: `docs/FEATURES.md`, `docs/STRUCTURE.md`, `CHANGELOG.md`.

## Review

- Plan critic (gpt-6-astra): five issues fixed before approval (static Help label and selectors, shadowed extension commands, budget order, delivery-focus arrows, reserved `>`).
- Code critic (gpt-6-astra): narrow busy hints advertised Steer/Queue while arrows moved the chip; ready-handoff prefill hid the chips. Both fixed with tests; re-check clean.

## Validation

- `npm test` 1733/1733; `npm run package:check` passed.
- Real Pi check (`agent-work/tickets/skill-reply-001/validation.md`): `/rev` + Tab ran `[skill] review`; `>` ran `[skill] reflect`, then the card offered `/commit`.

## Execution notes

- The real Pi check used `openai-codex/gpt-6-luna` because the Anthropic API key had no credit.

## Reflection Candidates

- `AGENTS.md` dashboard rules could list `>` among established keys.

## Discovered Work

None.
