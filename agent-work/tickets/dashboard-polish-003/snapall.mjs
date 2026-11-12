// Usage: node snapall.mjs dir count — screenshots dir/f<i>.html to dir/f<i>.png at 1x.
import { createRequire } from "node:module";
const require = createRequire("/Users/manager/.pi/agent/npm/node_modules/pi-playwright/package.json");
let pw; try { pw = require("playwright"); } catch { pw = require("playwright-core"); }
const [, , dir, count] = process.argv;
const b = await pw.chromium.launch({ executablePath: process.env.EXE || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
for (let i = 0; i < Number(count); i++) {
  await p.goto(new URL(`${dir}/f${i}.html`, "file://" + process.cwd() + "/").href);
  await (await p.$("body")).screenshot({ path: `${dir}/f${i}.png` });
}
await b.close();
