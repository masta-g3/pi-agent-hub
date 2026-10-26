import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepoPicker, moveRepoPickerSelection, openRepoPickerDir, renderRepoPicker, repoPickerParent, selectedRepoCwd, toggleRepoPickerMode,
} from "../src/tui/repo-picker.js";
import { createTextInput, insertText } from "../src/tui/text-input.js";

test("repo picker renders labels and compact paths", () => {
  const picker = createRepoPicker(["/Users/manager/Code/api", "/Users/manager/Code/web"]);
  const rendered = renderRepoPicker(picker, 80).join("\n");

  assert.match(rendered, /Recent repos/);
  assert.match(rendered, /api/);
  assert.match(rendered, /web/);
  assert.match(rendered, /~\/Code\/api|\/Users\/manager\/Code\/api/);
});

test("repo picker renders its search cursor at the stored position", () => {
  const picker = { ...createRepoPicker(["/tmp/api"]), filter: createTextInput("abcd", 2) };
  assert.match(renderRepoPicker(picker, 80).join("\n"), /search: ab█cd/);
});

test("repo picker filters by basename and full path", () => {
  let picker = createRepoPicker(["/tmp/api", "/tmp/mobile-client"]);
  picker = { ...picker, filter: insertText(picker.filter, "client") };

  assert.equal(selectedRepoCwd(picker), "/tmp/mobile-client");
});

test("repo picker movement follows visible rows", () => {
  let picker = createRepoPicker(["/tmp/api", "/tmp/web", "/tmp/worker"]);
  picker = { ...picker, filter: insertText(picker.filter, "w") };
  picker = moveRepoPickerSelection(picker, 1);

  assert.equal(selectedRepoCwd(picker), "/tmp/worker");
});

test("repo picker handles no matches", () => {
  let picker = createRepoPicker(["/tmp/api"]);
  picker = { ...picker, filter: insertText(picker.filter, "zzz") };

  assert.equal(selectedRepoCwd(picker), undefined);
  assert.match(renderRepoPicker(picker, 80).join("\n"), /No repos match/);
});

test("repo picker browses into folders, goes up, and selects a folder", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-hub-browse-"));
  mkdirSync(join(root, "api", "src"), { recursive: true });
  mkdirSync(join(root, "web"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "notes.txt"), "");
  try {
    let picker = toggleRepoPickerMode(createRepoPicker(["/tmp/recent"]), root);
    assert.equal(picker.mode, "browse");
    assert.deepEqual(picker.items.map((item) => item.label), ["../", "api/", "web/"]);
    assert.match(renderRepoPicker(picker, 80).join("\n"), /Browse/);

    picker = openRepoPickerDir(moveRepoPickerSelection(picker, 1));
    assert.equal(picker.dir, join(root, "api"));
    assert.deepEqual(picker.items.map((item) => item.label), ["../", "src/"]);

    picker = repoPickerParent(picker);
    assert.equal(picker.dir, root);
    picker = { ...picker, filter: insertText(picker.filter, "web") };
    assert.equal(selectedRepoCwd(picker), join(root, "web"));

    picker = toggleRepoPickerMode(picker, root);
    assert.equal(picker.mode, "recent");
    assert.equal(selectedRepoCwd(picker), "/tmp/recent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo picker browse starts at home when the start folder is missing", () => {
  const picker = toggleRepoPickerMode(createRepoPicker([]), "/definitely/missing/path");
  assert.equal(picker.dir, homedir());
});

test("repo picker opens a recent repo in browse mode", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-hub-browse-"));
  mkdirSync(join(root, "src"));
  try {
    const picker = openRepoPickerDir(createRepoPicker([root]));
    assert.equal(picker.mode, "browse");
    assert.equal(picker.dir, root);
    assert.deepEqual(picker.items.map((item) => item.label), ["../", "src/"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
