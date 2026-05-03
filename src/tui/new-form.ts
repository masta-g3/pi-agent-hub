import { basename } from "node:path";

export type FieldKey = "cwd" | "group" | "title";

export interface Field {
  key: FieldKey;
  label: string;
  value: string;
  hint?: string;
  error?: string;
  suggestions?: string[];
  cycleIndex?: number;
  truncate?: "end" | "start";
}

export interface NewFormState {
  fields: Record<FieldKey, Field>;
  focus: FieldKey;
  order: FieldKey[];
  titleTouched: boolean;
}

export interface NewFormContext {
  cwd: string;
  knownCwds?: string[];
  groupForCwd?: (cwd: string) => string | undefined;
}

const ORDER: FieldKey[] = ["cwd", "group", "title"];

export function createNewForm(ctx: NewFormContext): NewFormState {
  const cwd = ctx.cwd;
  const suggestions = uniqueWithFirst(cwd, ctx.knownCwds ?? []);
  const group = ctx.groupForCwd?.(cwd) ?? "default";
  return {
    fields: {
      cwd: {
        key: "cwd",
        label: "cwd",
        value: cwd,
        hint: cwdHint(suggestions.length),
        suggestions,
        cycleIndex: 0,
        truncate: "start",
      },
      group: { key: "group", label: "group", value: group, hint: "session group label" },
      title: { key: "title", label: "title", value: basename(cwd) || "session", hint: "defaults to cwd basename" },
    },
    focus: "cwd",
    order: ORDER,
    titleTouched: false,
  };
}

export function moveFocus(state: NewFormState, delta: number): NewFormState {
  const idx = state.order.indexOf(state.focus);
  const next = state.order[(idx + delta + state.order.length) % state.order.length];
  return { ...state, focus: next ?? state.focus };
}

export function setFocus(state: NewFormState, key: FieldKey): NewFormState {
  return { ...state, focus: key };
}

export function appendChar(state: NewFormState, char: string): NewFormState {
  const focus = state.focus;
  const field = state.fields[focus];
  const value = `${field.value}${char}`;
  return applyEdit(state, focus, value);
}

export function backspace(state: NewFormState): NewFormState {
  const focus = state.focus;
  const field = state.fields[focus];
  if (!field.value) return state;
  return applyEdit(state, focus, field.value.slice(0, -1));
}

export function cycleCwdSuggestion(state: NewFormState, delta: number): NewFormState {
  if (state.focus !== "cwd") return state;
  const cwd = state.fields.cwd;
  const suggestions = cwd.suggestions ?? [];
  if (suggestions.length === 0) return state;
  const current = cwd.cycleIndex ?? 0;
  const next = (current + delta + suggestions.length) % suggestions.length;
  const value = suggestions[next] ?? cwd.value;
  return applyEdit({
    ...state,
    fields: { ...state.fields, cwd: { ...cwd, cycleIndex: next } },
  }, "cwd", value);
}

export interface ValidationResult {
  ok: boolean;
  state: NewFormState;
}

export function validateNewForm(state: NewFormState): ValidationResult {
  const fields = { ...state.fields };
  let firstInvalid: FieldKey | undefined;
  for (const key of state.order) {
    const trimmed = fields[key].value.trim();
    if (!trimmed) {
      fields[key] = { ...fields[key], error: `${fields[key].label} is required` };
      firstInvalid ??= key;
    } else {
      fields[key] = { ...fields[key], error: undefined, value: trimmed };
    }
  }
  if (firstInvalid) return { ok: false, state: { ...state, fields, focus: firstInvalid } };
  return { ok: true, state: { ...state, fields } };
}

export function submission(state: NewFormState): { cwd: string; group: string; title: string } {
  return {
    cwd: state.fields.cwd.value.trim(),
    group: state.fields.group.value.trim(),
    title: state.fields.title.value.trim(),
  };
}

function applyEdit(state: NewFormState, key: FieldKey, value: string): NewFormState {
  const field = { ...state.fields[key], value, error: undefined };
  if (key === "cwd") field.cycleIndex = matchSuggestionIndex(value, field.suggestions);
  const fields = { ...state.fields, [key]: field };
  let titleTouched = state.titleTouched;
  if (key === "title") titleTouched = true;
  else if (key === "cwd" && !titleTouched) {
    fields.title = { ...fields.title, value: basename(value) || fields.title.value };
  }
  return { ...state, fields, titleTouched };
}

function matchSuggestionIndex(value: string, suggestions: string[] | undefined): number | undefined {
  if (!suggestions) return undefined;
  const idx = suggestions.indexOf(value);
  return idx >= 0 ? idx : undefined;
}

function uniqueWithFirst(first: string, items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [first, ...items]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function cwdHint(suggestionCount: number): string {
  if (suggestionCount > 1) return `current dir · ctrl-n cycles ${suggestionCount} known cwds`;
  return "current dir";
}
