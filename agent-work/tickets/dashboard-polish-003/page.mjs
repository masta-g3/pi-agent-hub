import { writeFileSync } from "node:fs";
const { frame } = await import(new URL("./demo.mjs", import.meta.url));
export const theme = { accent: "#89b4fa", success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8", muted: "#a6adc8", dim: "#7f849c", text: "", border: "#585b70", statusLineBg: "#181825", selectedBg: "#313244" };
const x256 = (n) => { if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; } if (n >= 16) { n -= 16; const c = [Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map(v => v ? 55 + v * 40 : 0); return `rgb(${c})`; } return ["#000","#c00","#0c0","#cc0","#00c","#c0c","#0cc","#ccc","#555","#f55","#5f5","#ff5","#55f","#f5f","#5ff","#fff"][n]; };
export function toHtml(text) {
  let fg = "", bg = "", bold = false, dim = false, out = "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  for (const part of text.split(/(\x1b\[[0-9;:]*m)/)) {
    const m = /^\x1b\[([0-9;:]*)m$/.exec(part);
    if (!m) { if (part) out += `<span style="${fg ? `color:${fg};` : ""}${bg ? `background:${bg};` : ""}${bold ? "font-weight:700;" : ""}${dim ? "opacity:.6;" : ""}">${esc(part)}</span>`; continue; }
    const c = m[1].split(/[;:]/).map(Number);
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      if (v === 0) { fg = bg = ""; bold = dim = false; } else if (v === 1) bold = true; else if (v === 2) dim = true; else if (v === 22) { bold = dim = false; }
      else if (v === 39) fg = ""; else if (v === 49) bg = "";
      else if (v === 38 || v === 48) { let col; if (c[i + 1] === 2) { col = `rgb(${c[i + 2]},${c[i + 3]},${c[i + 4]})`; i += 4; } else { col = x256(c[i + 2]); i += 2; } if (v === 38) fg = col; else bg = col; }
    }
  }
  return out;
}
export const css = `body{margin:0;background:#0b0d14;color:#cdd6f4;font:14px/1.3 "SF Mono",Menlo,monospace;padding:32px;display:inline-block}.win{background:#1e1e2e;border:1px solid #313244;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5);overflow:hidden}.bar{height:30px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#181825}.bar i{width:12px;height:12px;border-radius:50%;display:block}pre{background:#1e1e2e;display:inline-block;padding:0;margin:0 0 24px;font:inherit}h3{font:600 12px system-ui;color:#7f849c}`;
if (process.argv[1]?.endsWith("page.mjs")) {
const shots = JSON.parse(process.argv[2]);
const body = shots.map(([w, h, sel, extra]) => `<div class=win><div class=bar><i style=background:#f38ba8></i><i style=background:#f9e2af></i><i style=background:#a6e3a1></i></div><pre style="padding:8px 10px 4px">${toHtml(frame(w, h, sel, extra ?? {}, true, theme))}</pre></div>`).join("\n");
writeFileSync(process.argv[3], `<!doctype html><meta charset=utf8><style>${css}</style>${body}`);
}
