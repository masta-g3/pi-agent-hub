import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { qrMatrix } from "../core/qr.js";
import { plainTerminalText } from "../core/terminal-text.js";
import { glyphs, qrBlocks } from "./glyphs.js";
import { errorMessage, type DialogContextFor, type WebInboxActions } from "./dialog.js";
import { renderDialog, truncate } from "./layout.js";
import { DIALOG_CONTENT_X, footerHits, type DialogHit } from "./dialog-mouse.js";
import { noColor, styleToken } from "./theme.js";

/** The address the phone can open, bound when it was read. */
export interface PhoneInboxAddressDialog {
  kind: "phoneInbox";
  address: string;
  published: boolean;
  port: number;
  /** Browser feedback; it takes the status line, so the controls never move. */
  note?: string;
  opening?: boolean;
}

/** Shown while the address is read; Esc closes it, and a result applies only while this exact dialog is open. */
export interface PhoneInboxLoadingDialog { kind: "phoneInbox"; loading: true }

export type PhoneInboxDialog = PhoneInboxAddressDialog | PhoneInboxLoadingDialog;

export type PhoneInboxDialogContext = DialogContextFor<{ webInbox?: Pick<WebInboxActions, "openAddress">; requestRender?: () => void }>;

/** Fixed, not theme tokens: a phone camera needs dark modules on a light background whatever the theme. */
const QR_COLORS = { on: "\u001b[38;2;0;0;0;48;2;255;255;255m", off: "\u001b[0m" } as const;
const QUIET_ZONE = 4;
/** Frame top, title, rule, address, footer, frame bottom: the rows that always stay. */
const KEPT_ROWS = 6;
/** Kept rows plus the blank row and the status line around a QR code. */
const FIXED_ROWS = KEPT_ROWS + 2;
/** Matches `renderDialog()`'s inner width. */
const innerWidth = (width: number) => Math.max(20, Math.min(Math.max(20, width - 2), 86));

/** QR rows as terminal lines: two module rows per line with half blocks, black on white, quiet zone included. */
export function qrLines(text: string): string[] | undefined {
  const matrix = qrMatrix(text);
  if (!matrix || !qrBlocks) return undefined;
  const blocks = qrBlocks;
  const size = matrix.length + 2 * QUIET_ZONE;
  const dark = (x: number, y: number) => matrix[y - QUIET_ZONE]?.[x - QUIET_ZONE] === true;
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = "";
    for (let x = 0; x < size; x += 1) {
      const top = dark(x, y);
      const bottom = y + 1 < size && dark(x, y + 1);
      line += top && bottom ? blocks.full : top ? blocks.upper : bottom ? blocks.lower : " ";
    }
    lines.push(`${QR_COLORS.on}${line}${QR_COLORS.off}`);
  }
  return lines;
}

export function renderPhoneInboxDialog(dialog: PhoneInboxDialog, width: number, height: number | undefined, ctx: PhoneInboxDialogContext, hits?: DialogHit[]): string[] {
  const theme = ctx.theme;
  const tone = (token: "accent" | "muted" | "text" | "error", text: string) => theme ? styleToken(theme, token, text) : text;
  if ("loading" in dialog) {
    const footer = tone("muted", "Esc Close");
    const rows = [tone("muted", `Reading the phone inbox address${glyphs.ellipsis}`), footer];
    hits?.push(...footerHits(2 + rows.length, footer, DIALOG_CONTENT_X, innerWidth(width)));
    return renderDialog("Phone inbox", rows, width, theme);
  }
  const inner = innerWidth(width);
  const qr = dialog.published && !noColor() && qrBlocks ? qrLines(dialog.address) : undefined;
  const fits = qr && visibleWidth(qr[0]!) <= inner && (height === undefined || qr.length + FIXED_ROWS <= height);
  const body = !dialog.published
    ? [tone("text", "Not published to your phone."), tone("muted", `Run: tailscale serve --bg ${dialog.port}`)]
    : noColor()
      ? [tone("muted", "The QR code needs color (NO_COLOR is set).")]
      : !qrBlocks
        ? [tone("muted", "The QR code needs Unicode glyphs (ASCII mode is set).")]
      : !qr
        ? [tone("muted", "Address too long for a QR code.")]
        : fits ? qr : [tone("muted", "Enlarge for QR code")];
  const status = dialog.note
    ? tone(dialog.note.startsWith("Open") ? "muted" : "error", dialog.note)
    : fits ? tone("muted", "Scan with the phone camera.") : "";
  const open = ctx.actions.webInbox?.openAddress;
  const footer = tone("muted", [open ? "o Open in browser" : undefined, "Esc Close"].filter(Boolean).join(` ${glyphs.pendingStep} `));
  // A short window drops the blank row first, then the lines below the room, so the footer keeps its place.
  // A browser note outranks the body, so its result stays visible.
  const room = height === undefined ? Infinity : Math.max(0, height - KEPT_ROWS);
  const middle = room >= body.length + 2 ? ["", ...body, status]
    : dialog.note && room > 0 ? [...body.slice(0, room - 1), status]
      : [...body, status].slice(0, room);
  const rows = [tone("accent", truncate(dialog.address, inner)), ...middle, footer];
  // renderDialog adds the top border, title and rule above the rows.
  hits?.push(...footerHits(2 + rows.length, footer, DIALOG_CONTENT_X, inner));
  return renderDialog("Phone inbox", rows, width, theme);
}

/** Consumes every key while open, like the archive chooser, so letters never reach dashboard commands. */
export function handlePhoneInboxInput(dialog: PhoneInboxDialog, data: string, ctx: PhoneInboxDialogContext): PhoneInboxDialog | undefined {
  if (matchesKey(data, Key.escape)) return undefined;
  const open = ctx.actions.webInbox?.openAddress;
  if ("loading" in dialog || data !== "o" || !open || dialog.opening) return dialog;
  const opening: PhoneInboxAddressDialog = { ...dialog, opening: true, note: `Opening in browser${glyphs.ellipsis}` };
  // Not runAction: its errors go to the dashboard message, which this modal hides.
  const settle = (note: string) => {
    if (ctx.dialog() !== opening) return;
    ctx.setDialog({ ...opening, opening: false, note });
    ctx.actions.requestRender?.();
  };
  // One line: an error from `open` can carry stderr with newlines that would break the frame.
  const failure = (error: unknown) => {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
    return plainTerminalText(stderr.trim() || errorMessage(error)) || "could not open the browser";
  };
  open(dialog.address).then(() => settle("Opened in browser"), (error: unknown) => settle(failure(error)));
  return opening;
}
