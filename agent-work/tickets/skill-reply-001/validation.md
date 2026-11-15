# skill-reply-001 validation

End-to-end check, 2026-11-14. A Pi session in tmux loads only this worktree's Hub extension and the installed Rules `workflow-runtime` (`--no-extensions`, model `openai-codex/gpt-6-luna`), with the user's normal skills, as a managed session in a temporary `PI_AGENT_HUB_DIR`. It links ticket `demo-001` and completes Review. `pi-hub tui` runs from this worktree's `dist`.

1. The card shows `> Next: /reflect` as its first action.
2. `p`, `/rev`, `Tab`, words, `Enter`: Pi showed `[skill] review` with the words appended and replied `SKILL-OK review`.
3. `>`: Pi showed `[skill] reflect` and ran Reflect. The card then offered `> Next: /commit`, and Reply's chips picked `commit`.

## 80 columns, empty Reply (chips)

```text
▌   REPLY · Demo ticket · Send
▌   █
▌   plan-md execute review reflect [commit]
▌
▌    Enter Send /commit    ←/→ Step    Esc Keep draft
```

## 80 columns, typing /re (completion, one row per skill)

```text
▌   REPLY · Demo ticket · Send
▌   /re█
▌   ▌/reflect  Reflect on reviewed work and update durable docs or agent guidan…
▌    /review  Review finished work before reflection and commit.
▌    /next-feature  Select the next feature to implement from agent-work/featur…
▌
▌    ↑↓ Choose    Tab Complete    Esc Keep draft
```
