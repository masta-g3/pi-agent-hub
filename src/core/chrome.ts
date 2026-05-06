export interface ChromeThemeTokens {
  accent?: string | number;
  border?: string | number;
  dim?: string | number;
  muted?: string | number;
  statusLineBg?: string | number;
  text?: string | number;
}

export interface TmuxChrome {
  hintColor: string;
  statusStyle: string;
  windowStatusStyle: string;
  windowStatusCurrentStyle: string;
}

export const darkTmuxChrome: TmuxChrome = {
  hintColor: "#565f89",
  statusStyle: "bg=#1a1b26,fg=#a9b1d6",
  windowStatusStyle: "fg=#a9b1d6,bg=#1a1b26",
  windowStatusCurrentStyle: "fg=#a9b1d6,bg=#1a1b26",
};

export function tmuxChromeFromTheme(theme?: ChromeThemeTokens): TmuxChrome {
  if (!theme) return darkTmuxChrome;
  const foreground = tmuxColor(theme.text) ?? tmuxColor(theme.accent) ?? "#a9b1d6";
  const background = tmuxColor(theme.statusLineBg) ?? tmuxColor(theme.border) ?? "#1a1b26";
  const hintColor = tmuxColor(theme.muted) ?? tmuxColor(theme.dim) ?? "#565f89";
  return {
    hintColor,
    statusStyle: `bg=${background},fg=${foreground}`,
    windowStatusStyle: `fg=${foreground},bg=${background}`,
    windowStatusCurrentStyle: `fg=${foreground},bg=${background}`,
  };
}

function tmuxColor(value: string | number | undefined): string | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255 ? `colour${value}` : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^#?[0-9a-f]{6}$/i.test(trimmed) ? (trimmed.startsWith("#") ? trimmed : `#${trimmed}`) : undefined;
}
