# Model Badge

**Feature:** card-signal-004 → Model Badge
**Worktree:** none · **Branch:** main (pi-agent-hub, pi-tmux-subagents)
**Follow-up:** card-signal-005 (Orchestration Marker)

## Outcome

Live sessions show a short model tag on fleet title rows, pin metadata lines, subagent micro rows and board rows. The selected card adds the thinking level and provider.

```
▌    ⠋ Fix login bug   team   opus5.5   3m │    repo  opus5.5 · medium · claude-code
   └─ ● scout   son4.5 Inspect auth
  [team] repo · 3m · gpt5          (pin metadata line)
```

- Tags: `claude-opus-4-5` → `opus4.5`, `claude-sonnet-4-5-20250929` → `son4.5`, `gpt-5.1-codex` → `gpt5.1c`, `gemini-2.5-pro` → `gem2.5p`. Unknown ids are truncated to 8 cells.
- Vendor comes from the model id first, then the provider.
- `PI_AGENT_HUB_GLYPHS=nerd` adds a vendor icon (Nerd Fonts 3.5+): Claude U+EC82, OpenAI U+EC81, Google U+F02AD, robot U+EC20. The default and `ascii` sets show text only.
- The badge is the lowest-priority row signal: it shows only when every other signal and the whole title still fit.
- The model is live only: heartbeat `model {provider,id,thinking?}`, carried by the controller `liveDetails` map. Stopped rows show no badge, and it never enters `registry.json`.

## Decisions
- Icons are opt-in through the env var (user confirmed), not on by default and not a config key.
- Icons live in `nerdModelIcons`, not as `GlyphSet` keys, because ASCII glyph tests require every glyph to be printable.
- Subagents publish their model from their existing 2 s heartbeat (`pi-tmux-subagents` `hubActivityFields`). No new event hook.

## Review
- Fixed: board fitting ignored the mode label and `new` marker, and card metadata fitted the model before `↳N`/`⧉N`. A 30–160 column fleet and board sweep guards both.

## Verification
- pi-agent-hub `npm test`: 1742 pass. pi-tmux-subagents `npm test`: 175 pass.
