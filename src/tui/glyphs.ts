// Choose once per dashboard process. Never translate user or producer text.
export const unicode = {
  running: "●", waiting: "◐", idle: "○", error: "×", stopped: "-",
  spinner: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
  ready: "✓", question: "?", blocked: "!", expanded: "▾", collapsed: "▸",
  vertical: "│", treeEnd: "└", treeBranch: "├", horizontal: "─",
  selected: "▌", focus: "▎", filter: "▍", primary: "▶", cursor: "█", attentionBar: "┃",
  worktree: "⎇", worktreePending: "⎇…", worktreeWarning: "⎇!", worktreeDone: "⎇✓",
  repo: "◈", repos: "⧉", subagents: "⚙︎", activeStep: "◉", pendingStep: "·",
  progressFilled: "■", progressEmpty: "□", pinned: "▣", pin: "▢", abandoned: "⊘",
  topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯",
  up: "↑", down: "↓", left: "←", right: "→", fewer: "⌃", ellipsis: "…",
  quoteLeft: "“", quoteRight: "”", dash: "—", range: "–", artifact: "▤", favorite: "★",
  chevronLeft: "‹", chevronRight: "›", atLeast: "≥", note: "✎",
} as const;

type GlyphSet = { readonly [Key in keyof typeof unicode]: string };

export const ascii: GlyphSet = {
  running: "*", waiting: "~", idle: "o", error: "x", stopped: "-", spinner: "|/-\\",
  ready: "v", question: "?", blocked: "!", expanded: "v", collapsed: ">",
  vertical: "|", treeEnd: "`", treeBranch: "+", horizontal: "-",
  selected: ">", focus: ">", filter: "|", primary: ">", cursor: "_", attentionBar: "|",
  worktree: "@", worktreePending: "@...", worktreeWarning: "@!", worktreeDone: "@v",
  repo: "#", repos: "#", subagents: "+", activeStep: "O", pendingStep: ".",
  progressFilled: "#", progressEmpty: ".", pinned: "#", pin: "+", abandoned: "x",
  topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+",
  up: "^", down: "v", left: "<", right: ">", fewer: "^", ellipsis: "...",
  quoteLeft: '"', quoteRight: '"', dash: "--", range: "-", artifact: "#", favorite: "*",
  chevronLeft: "<", chevronRight: ">", atLeast: ">=", note: "*",
};

export const glyphs: GlyphSet = process.env.PI_AGENT_HUB_GLYPHS === "ascii" ? ascii : unicode;

/** Core lifecycle markers are stable data; only the TUI projection changes glyphs. */
export function worktreeGlyph(marker: string | undefined): string | undefined {
  const key = (["worktree", "worktreePending", "worktreeWarning", "worktreeDone"] as const)
    .find(key => unicode[key] === marker);
  return key ? glyphs[key] : undefined;
}
