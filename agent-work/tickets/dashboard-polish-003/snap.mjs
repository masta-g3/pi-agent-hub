import { createRequire } from "node:module";
const require = createRequire("/Users/manager/.pi/agent/npm/node_modules/pi-playwright/package.json");
let pw; try { pw = require("playwright"); } catch { pw = require("playwright-core"); }
const b = await pw.chromium.launch({ channel: process.env.CH || undefined, executablePath: process.env.EXE || undefined });
const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
await p.goto(new URL(process.argv[3], "file://" + process.cwd() + "/").href);
await (await p.$("body")).screenshot({ path: process.argv[2] });
await b.close();
