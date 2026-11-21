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
  requestReady: "✓", requestQuestion: "?", requestBlocked: "!", ticket: "#",
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
  requestReady: "v", requestQuestion: "?", requestBlocked: "!", ticket: "#",
};

/**
 * Nerd Font 3.x icons for session state, requests, workflow steps, disclosure and metadata markers. Every icon
 * is one cell wide and each state keeps its own shape, so rows still read without color. Separators, rules,
 * the selection stripe and dialog frames stay Unicode.
 */
export const nerd: GlyphSet = {
  ...unicode,
  running: "\u{F444}", waiting: "\u{F52B}", idle: "\u{F4C3}", error: "\u{F530}", stopped: "\u{F04D}",
  spinner: "\u{EE06}\u{EE07}\u{EE08}\u{EE09}\u{EE0A}\u{EE0B}",
  ready: "\u{F42E}", requestReady: "\u{F4A4}", requestQuestion: "\u{F420}", requestBlocked: "\u{F479}",
  expanded: "\u{F47C}", collapsed: "\u{F460}", activeStep: "\u{F192}", ticket: "\u{F412}",
  worktree: "\u{F418}", worktreeMerge: "\u{F419}", worktreeCheck: "\u{F421}", orchestration: "\u{F52E}",
  repos: "\u{F401}", subagents: "\u{EBBA}", artifact: "\u{F4A5}", note: "\u{F448}", favorite: "\u{F51F}",
  pinned: "\u{EBA0}", pin: "\u{EB2B}", abandoned: "\u{F468}", warning: "\u{F421}",
};

const mode = process.env.PI_AGENT_HUB_GLYPHS;
export const glyphs: GlyphSet = mode === "ascii" ? ascii : mode === "nerd" ? nerd : unicode;

/**
 * Nerd Font vendor icons for the model badge, enabled by `PI_AGENT_HUB_GLYPHS=nerd`; other sets show text only.
 * The Claude and OpenAI logos exist only in Nerd Fonts 3.5 patched fonts, not in the Symbols fallback font that
 * terminals bundle, so the badge uses a star, a hexagon and a robot that every 3.x font has.
 */
export const nerdModelIcons = { anthropic: "\u{F4F5}", openai: "\u{F02D9}", google: "\u{F02AD}", other: "\u{F06A9}" } as const;
export type ModelIcons = typeof nerdModelIcons;
export const modelIcons: ModelIcons | undefined = mode === "nerd" ? nerdModelIcons : undefined;

/**
 * Nerd Font icons that add cells instead of replacing a glyph: other sets show the text alone. `fields` and
 * `tools` are keyed by the label they lead; unknown labels take the default.
 */
export const nerdIcons = {
  brand: "\u{F03FF}", group: "\u{F413}",
  /** Rounded ends that turn a painted keycap or mode label into a pill. */
  capLeft: "\u{E0B6}", capRight: "\u{E0B4}",
  tiers: { "needs-you": "\u{F476}", health: "\u{F469}", new: "\u{F51B}", active: "\u{F500}", quiet: "\u{F4EE}", archived: "\u{F411}" },
  /** Request and error labels get a blank slot: the row's state icon already shows them. */
  fields: {
    ASK: " ", RDY: " ", BLK: " ", ERR: " ", GOAL: "\u{F4DE}", TASK: "\u{F4A0}",
    DOING: "\u{F427}", DONE: "\u{F42E}", NEXT: "\u{F432}", WHERE: "\u{F450}", NOW: "\u{F0E7}", LOG: "\u{F464}",
    SUB: "\u{EBBA}", SAID: "\u{F41F}",
  } as Record<string, string>,
  fieldDefault: "\u{F45E}",
  tools: {
    bash: "\u{F489}", read: "\u{F441}", edit: "\u{F448}", write: "\u{EA7F}", search: "\u{F422}", grep: "\u{F422}",
    find: "\u{F422}", ls: "\u{F413}", fetch: "\u{F484}", agent: "\u{F477}",
  } as Record<string, string>,
  toolDefault: "\u{F425}",
  /** Left, middle and right cells of a capped meter. */
  meterFilled: ["\u{EE03}", "\u{EE04}", "\u{EE05}"], meterEmpty: ["\u{EE00}", "\u{EE01}", "\u{EE02}"],
} as const;
export const icons: typeof nerdIcons | undefined = mode === "nerd" ? nerdIcons : undefined;

/** One cell of a task or quota meter; Nerd Font meters cap their first and last cells. */
export function meterCell(index: number, width: number, filled: boolean): string {
  if (!icons) return filled ? glyphs.quotaFilled : glyphs.quotaEmpty;
  return (filled ? icons.meterFilled : icons.meterEmpty)[index === 0 ? 0 : index === width - 1 ? 2 : 1]!;
}

/** Core lifecycle markers are stable data; only the TUI projection changes glyphs. */
export function worktreeGlyph(marker: string | undefined): string | undefined {
  const key = (["worktree", "worktreeMerge", "worktreeCheck"] as const)
    .find(key => unicode[key] === marker);
  return key ? glyphs[key] : undefined;
}
