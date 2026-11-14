import type { SessionSkill } from "./session-interaction.js";
import type { WorkflowSnapshot } from "./types.js";

const MATCHES_SHOWN = 6;

/** Skills for the `/` completion list: the input is `/name` or `/skill:name` with no space yet. */
export function skillMatches(input: string, skills: readonly SessionSkill[]): SessionSkill[] {
  if (!input.startsWith("/") || /\s/.test(input)) return [];
  const query = input.slice(1).replace(/^skill:/, "").toLowerCase();
  const prefix = skills.filter(skill => skill.name.startsWith(query));
  const inside = skills.filter(skill => !skill.name.startsWith(query) && skill.name.includes(query));
  return [...prefix, ...inside].slice(0, MATCHES_SHOWN);
}

/** `/review rest` becomes Pi's `/skill:review rest` when `review` is loaded; other text is sent as typed. */
export function toSkillCommand(text: string, skills: readonly SessionSkill[]): string {
  const name = /^\/([^\s:]+)(?=\s|$)/.exec(text)?.[1];
  return name && skills.some(skill => skill.name === name) ? `/skill:${text.slice(1)}` : text;
}

/** Workflow steps as reply chips when every step is a loaded skill; the pick is the step to send next. */
export function workflowSkillSteps(workflow: WorkflowSnapshot | undefined, skills: readonly SessionSkill[]): { ids: string[]; pick: number } | undefined {
  if (!workflow) return undefined;
  const ids = workflow.steps.map(step => step.id);
  if (!ids.every(id => skills.some(skill => skill.name === id))) return undefined;
  const pick = workflow.currentStepComplete ? Math.min(workflow.activeIndex + 1, ids.length - 1) : workflow.activeIndex;
  return { ids, pick };
}

/** The step after a completed one, when it is a loaded skill. */
export function nextSkill(workflow: WorkflowSnapshot | undefined, skills: readonly SessionSkill[]): string | undefined {
  if (!workflow?.currentStepComplete) return undefined;
  const id = workflow.steps[workflow.activeIndex + 1]?.id;
  return id && skills.some(skill => skill.name === id) ? id : undefined;
}
