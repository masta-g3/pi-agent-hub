import test from "node:test";
import assert from "node:assert/strict";
import { nextSkill, skillMatches, toSkillCommand, workflowSkillSteps } from "../src/core/skill-reply.js";
import type { WorkflowSnapshot } from "../src/core/types.js";

const skills = ["plan-md", "execute", "review", "reflect", "commit", "write-pr", "unslop", "test-coverage"].map(name => ({ name, description: `${name} skill` }));
const steps = [["plan-md", "PL"], ["execute", "EX"], ["review", "RV"], ["reflect", "RF"], ["commit", "CM"]].map(([id, short]) => ({ id: id!, short: short! }));
const at = (activeIndex: number, currentStepComplete?: boolean): WorkflowSnapshot => ({ steps, activeIndex, ...(currentStepComplete === undefined ? {} : { currentStepComplete }), updatedAt: 1 });

test("completion lists prefix matches before substring matches, accepts /skill:, and stops at a space", () => {
  assert.deepEqual(skillMatches("/re", skills).map(s => s.name), ["review", "reflect"]);
  assert.deepEqual(skillMatches("/skill:RE", skills).map(s => s.name), ["review", "reflect"]);
  // "execute" starts with e; the others only contain it, in list order.
  assert.deepEqual(skillMatches("/e", skills).map(s => s.name), ["execute", "review", "reflect", "write-pr", "test-coverage"]);
  assert.equal(skillMatches("/", skills).length, 6);
  assert.deepEqual(skillMatches("/review now", skills), []);
  assert.deepEqual(skillMatches("review", skills), []);
  assert.deepEqual(skillMatches("/zzz", skills), []);
});

test("a leading loaded skill name becomes Pi's skill command; everything else is unchanged", () => {
  assert.equal(toSkillCommand("/review focus on tests", skills), "/skill:review focus on tests");
  assert.equal(toSkillCommand("/review", skills), "/skill:review");
  assert.equal(toSkillCommand("/skill:review x", skills), "/skill:review x");
  assert.equal(toSkillCommand("/unknown x", skills), "/unknown x");
  assert.equal(toSkillCommand("please /review", skills), "please /review");
  assert.equal(toSkillCommand("/reviewer", skills), "/reviewer");
});

test("workflow chips pick the next step once the current one is complete, else the current step", () => {
  assert.deepEqual(workflowSkillSteps(at(2, true), skills), { ids: ["plan-md", "execute", "review", "reflect", "commit"], pick: 3 });
  assert.deepEqual(workflowSkillSteps(at(2, false), skills), { ids: ["plan-md", "execute", "review", "reflect", "commit"], pick: 2 });
  assert.deepEqual(workflowSkillSteps(at(4, true), skills), { ids: ["plan-md", "execute", "review", "reflect", "commit"], pick: 4 });
  assert.equal(workflowSkillSteps(undefined, skills), undefined);
  // A step that is not a loaded skill hides the chips: they would send text Pi cannot run.
  assert.equal(workflowSkillSteps(at(1, true), skills.filter(s => s.name !== "commit")), undefined);
});

test("the next step is offered only after a completed step whose successor is a loaded skill", () => {
  assert.equal(nextSkill(at(2, true), skills), "reflect");
  assert.equal(nextSkill(at(2, false), skills), undefined);
  assert.equal(nextSkill(at(2), skills), undefined);
  assert.equal(nextSkill(at(4, true), skills), undefined);
  assert.equal(nextSkill(undefined, skills), undefined);
  assert.equal(nextSkill(at(2, true), skills.filter(s => s.name !== "reflect")), undefined);
});
