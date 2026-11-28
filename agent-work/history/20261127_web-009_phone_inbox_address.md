**Feature:** web-009 → Phone inbox address
**Session:** 01a219b0-7ebd-712d-a3b9-7317ae79c630
**Worktree:** none
**Start branch:** n/a
**PR target:** n/a

# Phone inbox address

A click on the header `web` signal, or the palette entry **Phone inbox address**, opens a dialog with the address the phone can use. It copies the address, draws a QR code from Hub's own encoder when the address is published, and `o` opens it in the desktop browser.

## Decisions

- **Address:** read-only `tailscale serve status --json`; Hub never changes Serve. Only an HTTPS Serve root mount (`/`) that proxies to a running inbox port counts, because the page loads root-relative files. The address is `https://<host>`, plus `:<port>` when Serve does not use 443; only a `.ts.net` DNS host and a port from 1 to 65535 are accepted. Otherwise the dialog shows `http://127.0.0.1:<port>` and `tailscale serve --bg <port>`.
- **Choice of server:** `phoneInboxAddress()` reads Serve and the verified records fresh, takes the first running server that Serve publishes, else the first running server's loopback address, else reports off.
- **Copy:** the existing `copy` action (`pbcopy`, macOS). It reports no result, so the dialog never claims success.
- **QR code:** only for a published address. Fixed black-on-white colors, not theme tokens, so cameras read it on any theme. Not shown with `NO_COLOR`, with `PI_AGENT_HUB_GLYPHS=ascii`, or when the whole dialog does not fit (QR rows + 8 rows, and the frame's inner width); the dialog says why and keeps its address and footer at any height.
- **Encoder:** in-repo, no dependency. Byte mode, level M, versions 1–10 (up to 213 bytes); longer text gets no QR code.
- **Open:** `o` runs `execFile("open", [address])` on macOS only. The result shows in the dialog's status line; a pending open ignores repeats, a result after the dialog closed changes nothing, and errors are flattened to one line with `plainTerminalText()`.
- **Lookup:** the dialog opens at once in a loading state that Esc closes. The result applies only while that exact loading dialog is open, so a late result never copies or replaces another dialog.
- **Out of scope:** changing Tailscale, the full QR standard, other error levels, image export.

## Implementation

- `src/core/qr.ts`: `qrMatrix(text, mask?)`. Reed–Solomon over GF(256), level-M block tables and alignment centres for v1–10, version bits for v7–10. For each mask it writes the format and version bits before scoring with the four penalty rules; a tie keeps the lower mask.
- `src/core/tailscale-serve.ts`: `readServeStatus()` (own `execFile` with a 2 s timeout; stdout only) and `servedAddress()`.
- `src/tui/phone-inbox-dialog.ts`: loading and address states, `qrLines()` (half blocks, quiet zone of 4), fitting, input. Half-block characters live in `src/tui/glyphs.ts` as `qrBlocks`, because `src/tui/*.ts` holds no non-ASCII literals.
- `src/app/web-inbox.ts` (`phoneInboxAddress()`), `src/app/run-tui.ts` (wiring, `open`), `src/tui/dialog.ts`, `src/tui/dashboard-commands.ts` (`view:web-address`, shown while a server runs), `src/tui/sessions-view.ts` (click and palette open the dialog; the old address message was removed).
- Docs: `docs/FEATURES.md`, `docs/CONFIG.md`, `docs/STRUCTURE.md`.

## Verification

- `test/fixtures/qr-vectors.ts` was generated once from Nayuki's `qrcodegen`: one payload at each version 1–10 at that version's full capacity, the Tailscale address, and a UTF-8 string. Hub's matrices match bit for bit at a fixed mask, and the automatic mask choice matches. ZXing decoded every vector; OpenCV misses some valid codes, including the reference's own, so ZXing was the decoder.
- Tests: `qr`, `tailscale-serve`, dialog behavior in `web-inbox-view` (fit boundary 39×27 vs 38/26, short windows, NO_COLOR, unpublished, open flow, stale lookups), `web-inbox-lifecycle` (`phoneInboxAddress`), ASCII mode in `plain-terminal`. `npm test` in an isolated copy: 1933 pass.
- Manual check in an isolated copy with its own state, tmux server and a fake `tailscale`: the click opened the dialog, `pbpaste` returned the address, the QR lines captured from the real pane decoded with ZXing to `https://rpotec-mini.taila4d4da.ts.net`, `o` reported "Opened in browser", Esc closed it. tmux's capture splits the combined color into separate foreground and background codes.
- Review: code-critic, 3 passes; 5 findings fixed (stale lookups and Esc, multiline open errors, footer in short windows, Serve host and port validation).
- The reviewed build was installed globally, and the live inbox was restarted on it.
