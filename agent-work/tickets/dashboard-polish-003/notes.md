# README screenshot

Regenerate `assets/pi-agent-hub-dashboard.png` from the real renderer with anonymized sample sessions:

```bash
D=agent-work/tickets/dashboard-polish-003; OUT=$(mktemp -d)
npx tsc -p tsconfig.json --outDir $OUT/dist && ln -s $PWD/node_modules $OUT/node_modules && cp package.json $OUT/
ROOT=$OUT node $D/page.mjs '[[150,34,"panel"]]' $OUT/out.html
EXE=<path to a Playwright Chromium binary> node $D/snap.mjs assets/pi-agent-hub-dashboard.png $OUT/out.html
```

`demo.mjs` holds the sample fleet (from fleet-design-004); `page.mjs` converts ANSI frames to HTML; `snap.mjs` screenshots at 2x.
`snap.mjs` loads Playwright from the pi-playwright package. The GIF part of this ticket is not done.
