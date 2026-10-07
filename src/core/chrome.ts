export interface ChromeThemeTokens {
  accent?: string | number;
  border?: string | number;
  dim?: string | number;
  muted?: string | number;
  statusLineBg?: string | number;
  text?: string | number;
  warning?: string | number;
}

export interface TmuxChrome {
  hintColor: string;
  attentionColor: string;
  statusStyle: string;
  windowStatusStyle: string;
  windowStatusCurrentStyle: string;
  paneBorderStyle: string;
  paneActiveBorderStyle: string;
  paneBorderFormat: string;
}

export const darkTmuxChrome: TmuxChrome = {
  hintColor: "#565f89",
  attentionColor: "#e0af68",
  statusStyle: "bg=#1a1b26,fg=#a9b1d6",
  windowStatusStyle: "fg=#a9b1d6,bg=#1a1b26",
  windowStatusCurrentStyle: "fg=#a9b1d6,bg=#1a1b26",
  paneBorderStyle: "fg=#565f89",
  paneActiveBorderStyle: "fg=#7aa2f7",
  paneBorderFormat: "#{?pane_active,#[fg=#7aa2f7]#[reverse]#[bold] #{pane_title} #[default], #[fg=#565f89]#{pane_title}#[default] }",
};

export function tmuxChromeFromTheme(theme?: ChromeThemeTokens): TmuxChrome {
  if (!theme) return darkTmuxChrome;
  const foreground = tmuxColor(theme.text) ?? tmuxColor(theme.accent) ?? "#a9b1d6";
  const background = tmuxColor(theme.statusLineBg) ?? tmuxColor(theme.border) ?? "#1a1b26";
  const hintColor = tmuxColor(theme.muted) ?? tmuxColor(theme.dim) ?? "#565f89";
  const borderColor = tmuxColor(theme.border) ?? tmuxColor(theme.dim) ?? "#565f89";
  const accentColor = tmuxColor(theme.accent) ?? "#7aa2f7";
  return {
    hintColor,
    attentionColor: tmuxColor(theme.warning) ?? "#e0af68",
    statusStyle: `bg=${background},fg=${foreground}`,
    windowStatusStyle: `fg=${foreground},bg=${background}`,
    windowStatusCurrentStyle: `fg=${foreground},bg=${background}`,
    paneBorderStyle: `fg=${borderColor}`,
    paneActiveBorderStyle: `fg=${accentColor}`,
    // tmux condition branches use commas, so keep attributes in separate blocks.
    paneBorderFormat: `#{?pane_active,#[fg=${accentColor}]#[reverse]#[bold] #{pane_title} #[default], #[fg=${hintColor}]#{pane_title}#[default] }`,
  };
}

function tmuxColor(value: string | number | undefined): string | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255 ? `colour${value}` : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^#?[0-9a-f]{6}$/i.test(trimmed) ? (trimmed.startsWith("#") ? trimmed : `#${trimmed}`) : undefined;
}
