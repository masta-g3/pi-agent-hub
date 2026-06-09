export interface DashboardShortcut {
  key: string;
  label?: string;
  send: string;
  syncPiNameAfterMs?: number;
}

const RESERVED_DASHBOARD_KEYS = new Set([
  "n", "f", "g", "G", "e", "R", "r", "d", "w", "s", "m", "p", "a", "i", "N", "K", "J", "?", "q", "/",
  "Enter", "Esc", "Up", "Down", "j", "k", "Shift+Up", "Shift+Down",
  "M-n", "M-e", "C-q", "M-r", "C-m", "C-j", "C-[",
]);

export function normalizeDashboardShortcutKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("key is required");

  const lower = trimmed.toLowerCase();
  if (lower === "enter" || lower === "return") return "Enter";
  if (lower === "esc" || lower === "escape") return "Esc";
  if (lower === "up" || lower === "↑") return "Up";
  if (lower === "down" || lower === "↓") return "Down";
  if (lower === "shift+up" || lower === "shift-up") return "Shift+Up";
  if (lower === "shift+down" || lower === "shift-down") return "Shift+Down";

  const modifier = trimmed.match(/^(?:([cCmM])|ctrl|control|alt|meta)[+-](.)$/);
  if (modifier) {
    const prefix = modifier[1]?.toLowerCase() ?? (lower.startsWith("ctrl") || lower.startsWith("control") ? "c" : "m");
    const keyChar = modifier[2]?.toLowerCase();
    if (!keyChar) throw new Error("key is required");
    return `${prefix === "c" ? "C" : "M"}-${keyChar}`;
  }

  if (trimmed.length === 1) return trimmed;
  throw new Error(`unsupported key: ${key}`);
}

export function validateDashboardShortcuts(value: unknown): DashboardShortcut[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid dashboard.shortcuts in pi-agent-hub config");
  return value.map((shortcut, index) => validateDashboardShortcut(shortcut, index));
}

export function validateDashboardShortcut(value: unknown, index: number): DashboardShortcut {
  const prefix = `Invalid dashboard.shortcuts[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${prefix} in pi-agent-hub config`);
  if (typeof value.key !== "string") throw new Error(`${prefix}.key in pi-agent-hub config`);
  if (typeof value.send !== "string") throw new Error(`${prefix}.send in pi-agent-hub config`);
  const key = normalizeDashboardShortcutKey(value.key);
  if (RESERVED_DASHBOARD_KEYS.has(key)) throw new Error(`${prefix}.key: ${key} conflicts with a built-in dashboard shortcut`);

  if (/[\r\n]/.test(value.send)) throw new Error(`${prefix}.send must be one line`);
  const send = value.send.trim();
  if (!send) throw new Error(`${prefix}.send cannot be blank`);

  const shortcut: DashboardShortcut = { key, send };
  if (value.label !== undefined) {
    if (typeof value.label !== "string") throw new Error(`${prefix}.label in pi-agent-hub config`);
    const label = value.label.trim();
    if (label) shortcut.label = label;
  }
  if (value.syncPiNameAfterMs !== undefined) {
    const delay = value.syncPiNameAfterMs;
    if (typeof delay !== "number" || !Number.isInteger(delay) || delay < 100 || delay > 60_000) throw new Error(`${prefix}.syncPiNameAfterMs must be an integer from 100 to 60000`);
    shortcut.syncPiNameAfterMs = delay;
  }
  return shortcut;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
