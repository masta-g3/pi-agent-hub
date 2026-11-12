# README screenshot and daily-loop GIF

Both images are drawn by the real renderer with anonymized sample sessions from `demo.mjs`.
Re-run them after dashboard changes; unchanged code reproduces both files byte-for-byte.

```bash
D=agent-work/tickets/dashboard-polish-003; OUT=$(mktemp -d)
EXE=<path to a Playwright Chromium binary, e.g. ~/Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium>
npx tsc -p tsconfig.json --outDir $OUT/dist && ln -s $PWD/node_modules $OUT/node_modules && cp package.json $OUT/

# Screenshot
ROOT=$OUT node $D/page.mjs '[[150,34,"panel"]]' $OUT/out.html
EXE=$EXE node $D/snap.mjs assets/pi-agent-hub-dashboard.png $OUT/out.html

# GIF: drives SessionsView with real keys (], Tab, 2, Enter, ]) and captures each frame
ROOT=$OUT W=150 H=34 node $D/gif.mjs > $OUT/frames.json
ROOT=$OUT node $D/frames-html.mjs $OUT/frames.json $OUT
EXE=$EXE node $D/snapall.mjs $OUT 6
uv run --with pillow $D/encode.py $OUT/frames.json $OUT assets/pi-agent-hub-daily-loop.gif
```

- `demo.mjs`: sample fleet (from fleet-design-004) and a static frame renderer.
- `page.mjs`: ANSI-to-HTML converter, theme and window chrome; run directly for the screenshot.
- `gif.mjs`: the scripted loop. Step captions and hold times live here. Answering replaces the registry object, as a heartbeat refresh would, so the answered agent moves to ACTIVE.
- `frames-html.mjs`, `snapall.mjs`, `encode.py`: one HTML page and PNG per frame, then a GIF with one shared 64-color palette and per-frame timing.
- `snap.mjs` and `snapall.mjs` load Playwright from the pi-playwright package.
