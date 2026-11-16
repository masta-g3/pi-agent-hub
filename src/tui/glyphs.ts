// Choose once per dashboard process. Never translate user or producer text.
export const unicode = {
  running: "●", waiting: "◐", idle: "○", error: "×", stopped: "-",
  spinner: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
  ready: "✓", question: "?", blocked: "!", expanded: "▾", collapsed: "▸",
  vertical: "│", treeEnd: "└", treeBranch: "├", horizontal: "─",
  selected: "▌", focus: "▎", filter: "▍", primary: "▶", cursor: "█", attentionBar: "┃",
  worktree: "⎇", worktreeMerge: "⇡", worktreeCheck: "⚠", orchestration: "⊛",
  repos: "⧉", subagents: "↳", activeStep: "◉", pendingStep: "·",
  progressFilled: "■", progressEmpty: "□", pinned: "▣", pin: "▢", abandoned: "⊘",
  topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯",
  up: "↑", down: "↓", left: "←", right: "→", fewer: "⌃", ellipsis: "…",
  quoteLeft: "“", quoteRight: "”", dash: "—", range: "–", artifact: "▤", favorite: "★",
  quotaFilled: "▰", quotaEmpty: "▱", series: "█▓▒░", heatmap: "·░▒▓█", tinyBar: "▁", warning: "⚠", approximate: "≈", chartCursor: "▲", deltaDown: "▼", enter: "↵",
  chevronLeft: "‹", chevronRight: "›", atLeast: "≥", note: "✎",
} as const;

type GlyphSet = { readonly [Key in keyof typeof unicode]: string };

export const ascii: GlyphSet = {
  running: "*", waiting: "~", idle: "o", error: "x", stopped: "-", spinner: "|/-\\",
  ready: "v", question: "?", blocked: "!", expanded: "v", collapsed: ">",
  vertical: "|", treeEnd: "`", treeBranch: "+", horizontal: "-",
  selected: ">", focus: ">", filter: "|", primary: ">", cursor: "_", attentionBar: "|",
  worktree: "@", worktreeMerge: "^", worktreeCheck: "!", orchestration: "%",
  repos: "#", subagents: "+", activeStep: "O", pendingStep: ".",
  progressFilled: "#", progressEmpty: ".", pinned: "#", pin: "+", abandoned: "x",
  topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+",
  up: "^", down: "v", left: "<", right: ">", fewer: "^", ellipsis: "...",
  quoteLeft: '"', quoteRight: '"', dash: "--", range: "-", artifact: "#", favorite: "*",
  quotaFilled: "#", quotaEmpty: "-", series: "#=-.", heatmap: ".:-=#", tinyBar: ".", warning: "!", approximate: "~", chartCursor: "^", deltaDown: "v", enter: "Enter",
  chevronLeft: "<", chevronRight: ">", atLeast: ">=", note: "*",
};

export const glyphs: GlyphSet = process.env.PI_AGENT_HUB_GLYPHS === "ascii" ? ascii : unicode;

/** Nerd Font vendor icons for the model badge, enabled by `PI_AGENT_HUB_GLYPHS=nerd`; other sets show text only. */
export const nerdModelIcons = { anthropic: "\u{EC82}", openai: "\u{EC81}", google: "\u{F02AD}", other: "\u{EC20}" } as const;
export type ModelIcons = typeof nerdModelIcons;
export const modelIcons: ModelIcons | undefined = process.env.PI_AGENT_HUB_GLYPHS === "nerd" ? nerdModelIcons : undefined;

/** Core lifecycle markers are stable data; only the TUI projection changes glyphs. */
export function worktreeGlyph(marker: string | undefined): string | undefined {
  const key = (["worktree", "worktreeMerge", "worktreeCheck"] as const)
    .find(key => unicode[key] === marker);
  return key ? glyphs[key] : undefined;
}
