import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { isEnterKey } from "./text-input.js";

export function formatKey(binding: string): string {
  const modified = /^(C-|M-|S-|Ctrl\+|Alt\+|Shift\+)(.+)$/i.exec(binding);
  if (modified) {
    const modifier = modified[1]!.toLowerCase();
    const label = modifier === "c-" || modifier === "ctrl+" ? "Ctrl" : modifier === "m-" || modifier === "alt+" ? "Alt" : "Shift";
    const key = formatKey(modified[2]!);
    return `${label}+${key.length === 1 ? key.toUpperCase() : key}`;
  }
  const names: Record<string, string> = {
    enter: "Enter", return: "Enter", escape: "Esc", esc: "Esc", tab: "Tab", space: "Space",
    up: "↑", down: "↓", left: "←", right: "→", pageup: "PgUp", pagedown: "PgDn",
    pgup: "PgUp", pgdn: "PgDn", home: "Home", end: "End",
  };
  return names[binding.toLowerCase()] ?? binding;
}

export function matchesDashboardShortcut(data: string, key: string): boolean {
  if (key.startsWith("C-") && key.length === 3) return matchesKey(data, `ctrl+${key.slice(2)}` as KeyId);
  if (key.startsWith("M-") && key.length === 3) return matchesKey(data, `alt+${key.slice(2)}` as KeyId);
  if (key === "Enter") return isEnterKey(data);
  if (key === "Esc") return matchesKey(data, Key.escape);
  if (key === "Up") return matchesKey(data, Key.up);
  if (key === "Down") return matchesKey(data, Key.down);
  if (key === "Shift+Up") return matchesKey(data, Key.shift("up"));
  if (key === "Shift+Down") return matchesKey(data, Key.shift("down"));
  return data === key;
}
