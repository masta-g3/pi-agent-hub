import test from "node:test";
import assert from "node:assert/strict";
import { darkTmuxChrome, tmuxChromeFromTheme } from "../src/core/chrome.js";

test("tmuxChromeFromTheme returns dark fallback without a theme", () => {
  assert.deepEqual(tmuxChromeFromTheme(), darkTmuxChrome);
});

test("tmuxChromeFromTheme derives tmux hex colors from theme tokens", () => {
  assert.deepEqual(tmuxChromeFromTheme({ accent: "7aa2f7", border: "#547da7", dim: "#767676" }), {
    hintColor: "#767676",
    statusStyle: "bg=#547da7,fg=#7aa2f7",
    windowStatusStyle: "fg=#7aa2f7,bg=#547da7",
    windowStatusCurrentStyle: "fg=#7aa2f7,bg=#547da7",
  });
});

test("tmuxChromeFromTheme prefers non-empty text over accent", () => {
  assert.equal(tmuxChromeFromTheme({ text: "#111111", accent: "#222222", border: "#333333" }).statusStyle, "bg=#333333,fg=#111111");
});

test("tmuxChromeFromTheme prefers status line background over border", () => {
  assert.equal(tmuxChromeFromTheme({ accent: "#111111", border: "#7287fd", statusLineBg: "#dce0e8" }).statusStyle, "bg=#dce0e8,fg=#111111");
});

test("tmuxChromeFromTheme prefers muted over dim for hint text", () => {
  assert.equal(tmuxChromeFromTheme({ muted: 244, dim: 240 }).hintColor, "colour244");
});

test("tmuxChromeFromTheme converts numeric tokens to tmux colour indexes", () => {
  assert.deepEqual(tmuxChromeFromTheme({ accent: 33, border: 240, dim: 244 }), {
    hintColor: "colour244",
    statusStyle: "bg=colour240,fg=colour33",
    windowStatusStyle: "fg=colour33,bg=colour240",
    windowStatusCurrentStyle: "fg=colour33,bg=colour240",
  });
});

test("tmuxChromeFromTheme falls back for empty invalid and out-of-range colors", () => {
  assert.deepEqual(tmuxChromeFromTheme({ text: "", accent: "not-a-color", border: 256, dim: -1 }), darkTmuxChrome);
  assert.deepEqual(tmuxChromeFromTheme({ accent: 1.5, border: "#12345g", dim: "" }), darkTmuxChrome);
});
