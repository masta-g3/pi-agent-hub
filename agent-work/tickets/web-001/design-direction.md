# Web inbox (web-001): design direction

I read `src/tui/theme.ts`, `src/tui/glyphs.ts` and `inbox-design-lab.html`. I did not render anything. No files were changed.

## 1. Direction

**Main idea:** the phone page is the Hub roster laid out for a thumb. The request is the content. Everything else is a quiet instrument line beneath it.

**Kept from the TUI:**
- **Tier names and order:** NEEDS YOU, HEALTH, ACTIVE, QUIET, as text headings. Each heading ends with a count.
- **Glyphs from `glyphs.ts`:**
  - Runtime: `●` running, `◐` waiting, `○` idle, `×` error.
  - Requests: `?` question, `✓` ready, `!` blocked.
  - Child count: `↳N`.
- **Signal roles:**
  - `warning` means a request of any kind.
  - `error` means a fault.
  - `accent` means a control (buttons, focus, the composer edge).
  - `success` means live work only: a running `●` and `↳N`.
  - Finished marks use the normal text color.
- **The plate stripe:** a request card has a 4 px left edge in warning tone, or in error tone for a fault. This is the one bold element. Other rows have no plate.
- **Density:** a label appears only when it has a value. An unselected row has one title line plus at most one status line.

**Changed for touch:**
- Remove keycaps, the footer key band, `▌` row selection and the box-drawing layout. Tapping opens a row, so the phone needs no selection state.
- Show the LCD STEP readout only in the detail header. It is the one monospace element.
- Put actions at the bottom, in the thumb zone. The list has no floating buttons.

**Review step (what I changed in my first plan, and why):**
1. My first plan used a near-black page with one accent. That is a known default look, so I use Hub's own `statusLineBg` blue-black (`#1a1b26`) and its five role colors.
2. It drew every row as a card. That is the "card kit" look, so only request cards are plated. Other rows are flat lines with a hairline between them.
3. It used monospace for ages and steps. That is template chrome, so ages and steps are sans text with tabular numbers.

## 2. Tokens

```css
:root{
 color-scheme: light dark;
 --page:#f4f6f9; --band:#dce0e8; --plate:#ffffff; --text:#1c2230; --muted:#5d6675;
 --rule:#c8d0dc; --accent:#3f6f6f; --success:#3f7a3f; --warning:#8a6418; --error:#a24646;
 --warning-wash:#f6eedc; --error-wash:#f6e4e4;
 --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
 --mono:ui-monospace,"SF Mono",Menlo,monospace;   /* STEP readout only */
 --t-xs:12px; --t-sm:13px; --t-md:15px; --t-lg:17px; --t-xl:22px;
 --lh:1.35; --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px;
 --r-plate:10px; --r-btn:8px; --r-chip:999px;
 --tap:44px; --stripe:4px;
 --safe-t:env(safe-area-inset-top); --safe-b:env(safe-area-inset-bottom);
}
@media (prefers-color-scheme:dark){:root{
 --page:#1f2335; --band:#1a1b26; --plate:#272c42; --text:#c8d0ec; --muted:#9aa3bd;
 --rule:#3a4060; --accent:#7aa2f7; --success:#9ece6a; --warning:#e0af68; --error:#f7768e;
 --warning-wash:#33302a; --error-wash:#3a2731;
}}
```

The light role colors are Hub's light theme, darkened slightly so they reach WCAG AA contrast on `#ffffff`. Check every pair.

**Layout rules:**
- Header: `padding-top: calc(var(--safe-t) + 8px)`.
- Composer: `padding-bottom: max(var(--safe-b), 12px)`.
- Request titles: bold, `--t-lg`. Request text: `--t-md`. Meta text: `--t-sm` in the muted color, never bold.
- Ages: `font-variant-numeric: tabular-nums`.

## 3. Wireframes (390×844)

**List**

```
┌──────────────────────────────────────┐
│ Hub   3 requests        ● Live       │ band
├──────────────────────────────────────┤
│ NEEDS YOU · 3  ───────────────────── │
│┃? Question       Dashboard polish 4m │ plate, warning stripe
│┃  ui                                 │
│┃  Keep the ticket subtitle above the │
│┃  request when attention arrives?    │
│┃  [ Keep it ] [ Replace ] [ Ask me ] │ 44px buttons
│┃✓ Ready   Web inbox spec        12m  │
│┃  Recommends: plan-md → execute      │
│ HEALTH · 1  ──────────────────────── │
│┃× Sync worker      execute       2h  │ error stripe
│┃  tmux pane missing                  │
│ ACTIVE · 2  ──────────────────────── │
│ ● Usage chart   execute  ↳2     now  │
│   Running: npm run typecheck         │
│ QUIET · 5  ─────────────────── ▸     │ collapsed
└──────────────────────────────────────┘
```

**Detail**

```
┌──────────────────────────────────────┐
│ ‹ Inbox                  ● Live      │
│ Dashboard polish                     │ bold xl
│ inbox-004 · Reply on card            │ ticket subtitle
│ [ STEP  plan ✓ exec ◉ review · ]     │ LCD, mono
├──────────────────────────────────────┤
│┃? Scope — 1 of 2                     │
│┃  Keep the subtitle above…?          │
│┃  ( ) Keep it   ( ) Replace          │ radio/checkbox rows 44px
│┃  [ Type an answer…              ]   │
│ SAID  Tests pass; one question.  ▾   │
│ Conversation (read-only)             │
│  you: …  agent: …                    │ scrolls
├──────────────────────────────────────┤
│ Accepted · 14:02                     │ receipt line
│ [ Mark read ] [______________][Send] │ busy: [Steer][Queue]
└──────────────────────────────────────┘
```

**Settings sheet:**
- One toggle: "Notify this device".
- In a mobile browser tab, the toggle is disabled. Under it: "Add Hub to your Home Screen first, then open it from there." Show the Share → Add to Home Screen steps.

## 4. Interaction rules

**Adopt:**
1. **Requests first:** the list follows the order in `session-order.ts`, and NEEDS YOU always stays expanded.
2. **Thumb zone:** the composer, Send, Steer, Queue and Mark read stay bottom-anchored. Option buttons sit on the card.
3. **Explicit receipt:** the receipt line shows Submitting, Accepted, Rejected (with how to fix it) or Delivery unknown. It stays until the next state; do not use a toast. Show one receipt per session, bound to the session's exact IDs.
4. **Stale-connection banner:** after the heartbeat times out, the header shows `◌ Reconnecting · data from 3m ago`. All submit controls stay disabled until the next fresh snapshot.
5. **No destructive taps:** the page has no stop, delete, archive or restart controls. A tap on an inline option shows that option pressed and asks for confirmation ("Send 'Keep it'?"), because one tap is easy to make by mistake.
6. **Steer and Queue are separate buttons** with plain labels, as in Codex and Happy. Do not use a long-press menu.
7. **Drafts are kept per session.** Leaving the screen does not clear the draft.

**Reject (out of scope):**
- Terminal or pane mirroring.
- File diffs and code viewers.
- Starting new sessions.
- Voice input.
- Swipe-to-act gestures.
- Pull-to-refresh as the only way to get fresh data.
- Bottom tab bars.
- Chat bubbles with avatars.
- AI summaries.
- Badge counts on the app icon, beyond what notifications already give.

## 5. Top 5 mistakes that would make it look templated or unlike Hub

1. **A card for every row,** with a soft shadow and one radius everywhere. Only request and fault rows get a plate.
2. **A green "online" pill or success color on anything not running.** `success` means live work only. The connection state uses text and a glyph, with color only for a fault.
3. **Turning NEEDS YOU into a coloured eyebrow** with letter spacing, or putting monospace on small labels. The tier heading is information plus a count. Monospace is for the STEP readout only.
4. **iMessage-style conversation bubbles.** The history is a read-only plain-text log with role names.
5. **A terminal costume:** green-on-black, keycaps, box-drawing characters, a fake cursor. Keep Hub's glyphs and roles, and drop the terminal look.

## Risks

- Inline option buttons send with one tap unless the confirm step stays. Ask the parent to approve that step: one extra tap, in exchange for no accidental answers.
- The light role colors must be checked against WCAG AA on both the plate and the wash backgrounds.

**Next action:** the parent approves or changes the confirm step for inline options, then builds `web/index.html` from these tokens.
