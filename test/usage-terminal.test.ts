import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";

for (const mode of ["plain", "ascii"]) test(`usage ${mode} preserves patterns, controls and width`, () => {
  const script = `
    import {renderUsageView,createUsageView,quotaSegment} from './dist/src/tui/usage-view.js';
    import {parseUsageSnapshot,mergeUsageSnapshots} from './dist/src/core/usage.js';
    import {usageFixture,USAGE_NOW} from './dist/test/usage-fixture.js';
    import {darkTheme,stripAnsi} from './dist/src/tui/theme.js';
    import {visibleWidth} from '@earendil-works/pi-tui';
    const data=mergeUsageSnapshots([parseUsageSnapshot(usageFixture(),USAGE_NOW)]);
    const output=[];
    for(const tab of ['cost','tokens','limits']) for(const width of [30,40,50,60,80,100,140,160,200]) {
      const page=renderUsageView(data,{...createUsageView(),tab},width,34,USAGE_NOW,darkTheme);
      if(page.lines.some(line=>visibleWidth(line)>width)) throw Error('overflow');
      if(page.lines.some(line=>/\\x1b\\[(?:38|48);/.test(line))) throw Error('color in NO_COLOR');
      output.push(...page.lines.map(stripAnsi));
    }
    output.push(stripAnsi(quotaSegment(data,200,USAGE_NOW,darkTheme)));
    console.log(output.join('\\n'));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", PI_AGENT_HUB_GLYPHS: mode === "ascii" ? "ascii" : "unicode" } });
  assert.match(output, /\[Cost\]/);
  assert.match(output, mode === "ascii" ? /#/ : /█/, "the selected row keeps a solid fill");
  assert.match(output, mode === "ascii" ? /\| *(?:\.+ +)*\.+/ : /░/, "everything else keeps a light fill");
  assert.match(output, mode === "ascii" ? /#.*\|/ : /▰.*┃/);
  if (mode === "ascii") assert.doesNotMatch(output, /[█▓▒░▰▱┃⚠≈▲▼←→↑↓↵]/);
});
