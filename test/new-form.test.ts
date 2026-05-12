import test from "node:test";
import assert from "node:assert/strict";
import { addRepo, appendChar, createNewForm, cycleCwdSuggestion, removeFocusedRepo, setFocus, setRepoValue, submission } from "../src/tui/new-form.js";

test("new form defaults group to primary cwd basename and title to random slug", () => {
  const state = createNewForm({ cwd: "/repo/api" });

  assert.equal(state.fields.group.value, "api");
  assert.match(state.fields.title.value, /^[a-z]+-[a-z]+$/);
  assert.deepEqual(state.order, ["repo:0", "group", "title"]);
});

test("new form keeps random title while group auto-updates until edited", () => {
  let state = createNewForm({ cwd: "/repo/api", knownCwds: ["/repo/api", "/repo/web"], titleGenerator: () => "black-aleph" });

  state = setFocus(state, "repo:0");
  state = cycleCwdSuggestion(state, 1);

  assert.equal(state.fields.group.value, "web");
  assert.equal(state.fields.title.value, "black-aleph");
});

test("new form adds removes and submits dynamic repo rows", () => {
  let state = createNewForm({ cwd: "/repo/api", titleGenerator: () => "api" });
  state = addRepo(state);
  for (const char of "/repo/web") state = appendChar(state, char);
  state = addRepo(state);
  for (const char of "/repo/shared") state = appendChar(state, char);

  assert.deepEqual(state.order, ["repo:0", "repo:1", "repo:2", "group", "title"]);
  assert.deepEqual(submission(state), { cwd: "/repo/api", group: "api", title: "api", additionalCwds: ["/repo/web", "/repo/shared"] });

  state = removeFocusedRepo(state);
  assert.deepEqual(state.order, ["repo:0", "repo:1", "group", "title"]);
  assert.deepEqual(submission(state), { cwd: "/repo/api", group: "api", title: "api", additionalCwds: ["/repo/web"] });
});

test("new form omits blank extra repo rows", () => {
  const state = addRepo(createNewForm({ cwd: "/repo/api", titleGenerator: () => "api" }));

  assert.deepEqual(submission(state), { cwd: "/repo/api", group: "api", title: "api" });
});

test("new form cycles cwd suggestions on focused extra repo rows", () => {
  let state = createNewForm({ cwd: "/repo/api", knownCwds: ["/repo/api", "/repo/web", "/repo/shared"] });
  state = addRepo(state);
  state = cycleCwdSuggestion(state, 1);
  assert.equal(state.fields["repo:1"].value, "/repo/api");
  state = cycleCwdSuggestion(state, 1);
  assert.equal(state.fields["repo:1"].value, "/repo/web");
});

test("new form sets repo values through picker selection", () => {
  let state = createNewForm({ cwd: "/repo/api", knownCwds: ["/repo/api", "/repo/web"], titleGenerator: () => "api" });
  state = setRepoValue(state, "repo:0", "/repo/web");

  assert.equal(state.fields["repo:0"].value, "/repo/web");
  assert.equal(state.fields.group.value, "web");
});
