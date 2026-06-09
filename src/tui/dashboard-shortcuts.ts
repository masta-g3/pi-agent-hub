import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";

export function matchesDashboardShortcut(data: string, key: string): boolean {
  if (key.startsWith("C-") && key.length === 3) return matchesKey(data, `ctrl+${key.slice(2)}` as KeyId);
  if (key.startsWith("M-") && key.length === 3) return matchesKey(data, `alt+${key.slice(2)}` as KeyId);
  if (key === "Enter") return matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r";
  if (key === "Esc") return matchesKey(data, Key.escape);
  if (key === "Up") return matchesKey(data, Key.up);
  if (key === "Down") return matchesKey(data, Key.down);
  if (key === "Shift+Up") return matchesKey(data, Key.shift("up"));
  if (key === "Shift+Down") return matchesKey(data, Key.shift("down"));
  return data === key;
}
