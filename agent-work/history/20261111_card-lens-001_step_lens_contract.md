**Feature:** card-lens-001 → Step Lens Contract
**Epic:** card-lens (`agent-work/plans/card-lens-000.md`) · **Repos:** pi-agent-hub, rules · **Target:** `card-lens-integration`

# card-lens-001 · Step Lens Contract

Rules publishes one step-agnostic `lens` inside each `workflow-runtime` entry. Hub draws it on the selected fleet card and the roster line without checking any step id. Pins, the board and the phone inbox keep their earlier inputs.

## Contract

```ts
type WorkflowLens = {
  doing?: string;                                                   // ≤ 160
  stages?: { label: string; state: "done" | "active" | "pending" }[]; // 1–12, label ≤ 24
  progress?: { completed: number; total: number; unit?: string };    // unit ≤ 16
  pass?: number;                                                    // ≥ 2
  list?: { label: string; head?: string;                             // label ≤ 6 cells, head ≤ 120
           items: { state: "done" | "active" | "pending" | "attention" | "skipped"; text: string }[]; // 1–12, ≤ 120
           before: number; after: number };
};
```

Hub validates each field on its own; a malformed field is dropped without hiding the rest or the rail.

## Implemented

- **Rules (`core.ts`):** activities carry a `stage` label (plan-md inspect/scope/write/critic/critic/ready; review review/fix/done; reflect review/update/done; commit archive/commit). `workflowLens()` runs in `withWorkflowDefinition`. Execute: first open task, phase-number stages (windowed to 12 around the current phase), task counts, and a `PLAN` list of the current phase's task window. Other steps: activity label, the step's stages, and the highest review pass. A finished step or no active step publishes no lens. The published `plan` omits `current`; `findLatestState` strips a stored `lens` on restore.
- **Hub data:** `WorkflowLens` on `WorkflowSnapshot`; `parseWorkflowLens` (list label measured with pi-tui `visibleWidth`); `retainedWorkflow` keeps the lens in `registry.json`, so stopped and stale sessions keep their card. Removed `plan.current` parsing, the controller checklist overlay and its retention stripping. `fork-compact` treats `lens` as a workflow field.
- **Hub layout:** the card shows request/ERR, `DOING` (else DONE/NEXT), one `WHERE` line (rail, `│` stages, meter and count, `pass N`, mode; narrow widths drop mode, pass, meter, stages, count, then use the compact rail; below 80 columns a plain step), the lens list (`✓ ◉ · ! –`, `✓ N earlier`/`· N more`), then NOW (live tool call or `Thinking…` only), LOG, SUB, SAID. The roster line shows `DOING` with lens progress after requests and errors, ahead of the live tool call. The STEP/TASK/PHASE readout, `planFieldLines`, the LCD surface and the activity fallbacks are gone; pin and board paths still use `executePlan`.
- **Label column:** grows from 4 to 5 cells so `DOING`/`WHERE` fit; every value starts at column 7.
- **Docs:** CONFIG (lens bridge, bounds, retention), FEATURES (card fields), STRUCTURE, CHANGELOG, Rules README; reflect updated `pi-agent-hub/AGENTS.md` TUI rules.

## Verification

Rules `uv run pytest -q` 91 passed; Hub `npm test` 1690 passed, then `npm run package:check` passed. End-to-end run with both worktrees' extensions and this worktree's `pi-hub tui`: `agent-work/tickets/card-lens-001/validation.md` (Execute 160, Review 160/80, stopped session).

## Notes for later tickets

- 002–004 inherit the 5-cell label column; wider producer labels render with one space instead of throwing.
- With no lens, a session with only an activity shows its title row alone on the roster.
