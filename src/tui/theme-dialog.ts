import { Key, matchesKey } from "@earendil-works/pi-tui";
import { NARROW_LAYOUT_MAX_WIDTH, renderDialog, wrapWords } from "./layout.js";
import { errorMessage, isPromise, type DialogContext, type SessionsViewActions } from "./dialog.js";
import { parseAutomaticTheme, stripAnsi, styleToken, type SessionsTheme } from "./theme.js";

export type ThemeDialogSelection = "automatic" | "automaticLight" | "automaticDark" | "sync" | `theme:${string}`;

export interface ThemeDialog {
  kind: "theme";
  names: string[];
  setting: string;
  syncPi: boolean;
  selected: ThemeDialogSelection;
  originalSetting: string;
  automaticPair: { lightTheme: string; darkTheme: string };
  pending?: boolean;
  error?: string;
  detailOffset?: number;
}

export interface ThemeDialogInput {
  names: string[];
  setting: string;
  syncPi: boolean;
}

interface ThemeDialogContext {
  viewport: DialogContext["viewport"];
  actions: Pick<SessionsViewActions, "previewDashboardTheme" | "cancelDashboardTheme" | "applyDashboardTheme">;
  close(): void;
  setDialog(dialog: ThemeDialog): void;
  setMessage(message: string | undefined): void;
  flashMessage(text: string): void;
}

export function createThemeDialog(input: ThemeDialogInput): ThemeDialog {
  const names = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))];
  const automatic = parseAutomaticTheme(input.setting);
  const selected: ThemeDialogSelection = automatic ? "automatic" : names.includes(input.setting) ? `theme:${input.setting}` : "automatic";
  return {
    kind: "theme",
    names,
    setting: input.setting,
    syncPi: input.syncPi,
    selected,
    originalSetting: input.setting,
    automaticPair: automatic ?? {
      lightTheme: names.includes("light") ? "light" : names[0] ?? "light",
      darkTheme: names.includes("dark") ? "dark" : names[0] ?? "dark",
    },
  };
}

export function handleThemeDialogInput(dialog: ThemeDialog, data: string, ctx: ThemeDialogContext): ThemeDialog | undefined {
  if (dialog.pending) return dialog;
  if (matchesKey(data, Key.escape)) {
    ctx.actions.cancelDashboardTheme?.(dialog.originalSetting);
    return undefined;
  }
  if (matchesKey(data, Key.pageUp)) return moveThemeDetail(dialog, -2, ctx);
  if (matchesKey(data, Key.pageDown)) return moveThemeDetail(dialog, 2, ctx);
  if (matchesKey(data, Key.enter)) {
    const apply = ctx.actions.applyDashboardTheme;
    if (!apply) return { ...dialog, error: "theme settings unavailable" };
    const pending = { ...dialog, pending: true, error: undefined };
    ctx.setDialog(pending);
    try {
      const result = apply(dialog.setting, dialog.syncPi);
      if (!isPromise(result)) {
        ctx.close();
        ctx.flashMessage("theme saved");
        return undefined;
      }
      void result.then(() => {
        ctx.close();
        ctx.setMessage(undefined);
        ctx.flashMessage("theme saved");
      }).catch((error: unknown) => {
        ctx.setDialog({ ...pending, pending: false, error: errorMessage(error) });
      });
      return pending;
    } catch (error) {
      return { ...pending, pending: false, error: errorMessage(error) };
    }
  }

  if (data === " " || (dialog.selected === "sync" && (matchesKey(data, Key.left) || matchesKey(data, Key.right)))) {
    return { ...dialog, syncPi: !dialog.syncPi, error: undefined };
  }
  if ((dialog.selected === "automaticLight" || dialog.selected === "automaticDark") && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
    const automatic = dialog.automaticPair;
    const current = dialog.selected === "automaticLight" ? automatic.lightTheme : automatic.darkTheme;
    const nextName = cycle(dialog.names, current, matchesKey(data, Key.right) ? 1 : -1);
    const automaticPair = dialog.selected === "automaticLight"
      ? { ...automatic, lightTheme: nextName }
      : { ...automatic, darkTheme: nextName };
    const setting = `${automaticPair.lightTheme}/${automaticPair.darkTheme}`;
    ctx.actions.previewDashboardTheme?.(setting);
    return { ...dialog, setting, automaticPair, error: undefined };
  }
  if (matchesKey(data, Key.down) || data === "j" || matchesKey(data, Key.up) || data === "k") {
    const rows = selectionRows(dialog);
    const current = Math.max(0, rows.indexOf(dialog.selected));
    const delta = matchesKey(data, Key.down) || data === "j" ? 1 : -1;
    const selected = rows[(current + delta + rows.length) % rows.length] ?? dialog.selected;
    const setting = settingForSelection(dialog, selected);
    if (setting !== dialog.setting) ctx.actions.previewDashboardTheme?.(setting);
    return { ...dialog, selected, setting, error: undefined };
  }
  return dialog;
}

export function renderThemeDialog(dialog: ThemeDialog, width: number, height: number | undefined, theme?: SessionsTheme): string[] {
  const automatic = parseAutomaticTheme(dialog.setting);
  const rows = selectionRows(dialog).filter((row) => row !== "sync");
  const innerWidth = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const narrow = width <= NARROW_LAYOUT_MAX_WIDTH;
  const errorLines = dialog.error ? wrapWords(dialog.error, innerWidth, innerWidth) : [];
  const errorLimit = errorLines.length ? Math.max(1, Math.min(3, height === undefined ? 3 : height - 9)) : 0;
  const errorOffset = Math.max(0, Math.min(dialog.detailOffset ?? 0, Math.max(0, errorLines.length - errorLimit)));
  const visibleErrors = errorLines.slice(errorOffset, errorOffset + errorLimit);
  const footerRows = narrow ? 2 : 1;
  const maxVisible = Math.max(1, (height ?? Number.POSITIVE_INFINITY) - 6 - footerRows - visibleErrors.length);
  const selectedIndex = dialog.selected === "sync" ? 0 : Math.max(0, rows.indexOf(dialog.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), rows.length - maxVisible));
  const visible = rows.slice(start, start + maxVisible);
  const itemRows = visible.map((row) => renderSelection(row, dialog, automatic, theme));
  if (start > 0 && itemRows.length && visible[0] !== dialog.selected) itemRows[0] = theme ? styleToken(theme, "dim", "  …") : "  …";
  if (start + maxVisible < rows.length && itemRows.length && visible[itemRows.length - 1] !== dialog.selected) itemRows[itemRows.length - 1] = theme ? styleToken(theme, "dim", "  …") : "  …";
  const syncLabel = `${dialog.selected === "sync" ? "▎" : " "} Sync to Pi`;
  const syncState = dialog.syncPi ? "[✓] on" : "[ ] off";
  const sync = `${syncLabel}${" ".repeat(Math.max(1, innerWidth - stripAnsi(syncLabel).length - syncState.length))}${syncState}`;
  const footers = dialog.pending
    ? ["Saving theme..."]
    : narrow
      ? ["↑↓ Move · ←→ Choice · Space Sync", "Enter Save · Esc Cancel"]
      : ["↑↓ move · ←→ Automatic choice · space sync · enter apply · esc cancel"];
  const errors = visibleErrors.map((line) => theme ? styleToken(theme, "error", line) : line);
  return renderDialog("Theme", [...itemRows, "", selected(theme, dialog.selected === "sync", sync), ...errors, ...footers], width, theme);
}

function moveThemeDetail(dialog: ThemeDialog, delta: number, ctx: ThemeDialogContext): ThemeDialog {
  const { width, height } = ctx.viewport;
  const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
  const lines = dialog.error ? wrapWords(dialog.error, inner, inner) : [];
  const limit = Math.max(1, Math.min(3, height === undefined ? 3 : height - 9));
  const maxOffset = Math.max(0, lines.length - limit);
  return { ...dialog, detailOffset: Math.max(0, Math.min(Math.min(dialog.detailOffset ?? 0, maxOffset) + delta, maxOffset)) };
}

function renderSelection(row: ThemeDialogSelection, dialog: ThemeDialog, automatic: ReturnType<typeof parseAutomaticTheme>, theme?: SessionsTheme): string {
  if (row === "sync") return "";
  if (row === "automatic") return selected(theme, dialog.selected === row, `${dialog.selected === row ? "▎" : " "} ${automatic ? "[✓]" : "[ ]"} Automatic`);
  if (row === "automaticLight") return selected(theme, dialog.selected === row, `${dialog.selected === row ? "▎" : " "}     Light theme  ${automatic?.lightTheme ?? "light"}`);
  if (row === "automaticDark") return selected(theme, dialog.selected === row, `${dialog.selected === row ? "▎" : " "}     Dark theme   ${automatic?.darkTheme ?? "dark"}`);
  const name = row.slice("theme:".length);
  return selected(theme, dialog.selected === row, `${dialog.selected === row ? "▎" : " "} ${!automatic && dialog.setting === name ? "[✓]" : "[ ]"} ${name}`);
}

function selected(theme: SessionsTheme | undefined, active: boolean, text: string): string {
  return active && theme ? styleToken(theme, "accent", text) : text;
}

function selectionRows(dialog: ThemeDialog): ThemeDialogSelection[] {
  const automatic = parseAutomaticTheme(dialog.setting);
  return [
    "automatic",
    ...(automatic ? ["automaticLight" as const, "automaticDark" as const] : []),
    ...dialog.names.map((name): ThemeDialogSelection => `theme:${name}`),
    "sync",
  ];
}

function settingForSelection(dialog: ThemeDialog, selection: ThemeDialogSelection): string {
  if (selection === "automatic" || selection === "automaticLight" || selection === "automaticDark") return automaticSetting(dialog);
  if (selection.startsWith("theme:")) return selection.slice("theme:".length);
  return dialog.setting;
}

function automaticSetting(dialog: ThemeDialog): string {
  const pair = dialog.automaticPair;
  return `${pair.lightTheme}/${pair.darkTheme}`;
}

function cycle(names: string[], current: string, delta: -1 | 1): string {
  if (!names.length) return current;
  const index = Math.max(0, names.indexOf(current));
  return names[(index + delta + names.length) % names.length] ?? current;
}
