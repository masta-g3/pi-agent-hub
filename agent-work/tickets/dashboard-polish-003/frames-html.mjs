// Usage: node frames-html.mjs frames.json outDir — writes one HTML page per frame plus frames.txt for ffmpeg.
import { readFileSync, writeFileSync } from "node:fs";
const { toHtml, css } = await import(new URL("./page.mjs", import.meta.url));
const [, , input, dir] = process.argv;
const frames = JSON.parse(readFileSync(input, "utf8"));
const caption = "font:600 15px/1 system-ui,-apple-system,sans-serif;color:#cdd6f4;margin:0 0 14px;letter-spacing:.01em";
frames.forEach((f, i) => writeFileSync(`${dir}/f${i}.html`, `<!doctype html><meta charset=utf8><style>${css}</style><p style="${caption}">${f.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p><div class=win><div class=bar><i style=background:#f38ba8></i><i style=background:#f9e2af></i><i style=background:#a6e3a1></i></div><pre style="padding:8px 10px 4px">${toHtml(f.lines.join("\n"))}</pre></div>`));
writeFileSync(`${dir}/frames.txt`, frames.map((f, i) => `file 'f${i}.png'\nduration ${f.hold}`).join("\n") + `\nfile 'f${frames.length - 1}.png'\n`);
console.log(frames.length);
