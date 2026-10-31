import { glyphs } from "./glyphs.js";
import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { ANSWER_NOTES_LIMIT, type AnswerInput, type InteractionTarget, type PendingQuestion } from "../core/session-interaction.js";
import { createForm, editField, setValue, type FormState } from "./form.js";
import { createTextInput, insertText, isEnterKey } from "./text-input.js";
import { cleanMarkdown } from "./conversation.js";
import { styleToken, type SessionsTheme } from "./theme.js";
import type { RenderCardPanel } from "./render-model.js";

export interface QuestionDialog {
  target: InteractionTarget;
  title: string;
  request: PendingQuestion;
  attentionRequestId?: string;
  answers: AnswerInput[];
  staged: { choice: number; selected: Set<number>; text: string; cursor: number }[];
  page: number;
  choice: number;
  selected: Set<number>;
  custom?: FormState<"answer">;
  noteEditor?: FormState<"note">;
  notes: string[];
  contextExpanded: boolean;
  originalVisible: boolean;
  scroll: number;
  submitting: boolean;
  uncertain: boolean;
  error?: string;
  available: boolean;
}
export function createQuestionDialog(target: InteractionTarget, title: string, request: PendingQuestion, attentionRequestId?: string): QuestionDialog {
  return { target: { ...target }, title, request: structuredClone(request), attentionRequestId,
    answers: [], staged: [], notes: [], contextExpanded: false, originalVisible: false, page: 0, choice: 0, selected: new Set(), scroll: 0, submitting: false, uncertain: false, available: true };
}
function stage(dialog: QuestionDialog): void {
  const field = dialog.custom?.fields.answer;
  const previous = dialog.staged[dialog.page];
  dialog.staged[dialog.page] = { choice: dialog.choice, selected: new Set(dialog.selected), text: field?.value ?? previous?.text ?? "", cursor: field?.cursor ?? previous?.cursor ?? 0 };
}
function editCustom(dialog: QuestionDialog): void {
  delete dialog.answers[dialog.page];
  const previous = dialog.staged[dialog.page];
  dialog.choice = dialog.request.params.questions[dialog.page]!.options.length;
  dialog.custom = createForm([{ key: "answer", label: "Answer", value: previous?.text ?? "", hint: "Your custom answer" }]);
  if (previous) dialog.custom = setValue(dialog.custom, "answer", previous.text, previous.cursor);
}
export function handleQuestionInput(dialog: QuestionDialog, data: string): "changed" | "close" | "submit" {
  if (matchesKey(data, Key.escape)) {
    if (dialog.submitting) return "changed";
    stage(dialog);
    if (dialog.noteEditor) { saveNote(dialog); return "changed"; }
    if (dialog.custom) { dialog.custom = undefined; return "changed"; }
    return "close";
  }
  if (!dialog.available || dialog.submitting || dialog.uncertain) return "changed";
  const question = dialog.request.params.questions[dialog.page];
  if (!question) return "changed";
  if (dialog.noteEditor) {
    if (isEnterKey(data)) { saveNote(dialog); return "changed"; }
    dialog.noteEditor = editQuestionField(dialog.noteEditor, data);
    if (dialog.noteEditor.fields.note.value.length > ANSWER_NOTES_LIMIT) {
      dialog.noteEditor = setValue(dialog.noteEditor, "note", dialog.noteEditor.fields.note.value.slice(0, ANSWER_NOTES_LIMIT));
    }
    return "changed";
  }
  if (dialog.custom) {
    if (isEnterKey(data)) {
      const text = dialog.custom.fields.answer.value.trim();
      if (!text) { dialog.error = "Enter a custom answer"; return "changed"; }
      return commit(dialog, { questionIndex: dialog.page, kind: "custom", text });
    } else dialog.custom = editQuestionField(dialog.custom, data);
    return "changed";
  }
  if (data === "C") { dialog.contextExpanded = !dialog.contextExpanded; return "changed"; }
  if (data === "O") { dialog.originalVisible = !dialog.originalVisible; return "changed"; }
  if (data === "n") { dialog.noteEditor = createForm([{ key: "note", label: "Note", value: dialog.notes[dialog.page] ?? "" }]); return "changed"; }
  if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
    showQuestionPage(dialog, Math.max(0, Math.min(dialog.request.params.questions.length - 1, dialog.page + (matchesKey(data, Key.left) ? -1 : 1))));
    return "changed";
  }
  const numeric = /^[1-9]$/.test(data) ? Number(data) - 1 : -1;
  if (numeric === question.options.length || data === "t") { editCustom(dialog); return "changed"; }
  if (numeric >= 0 && numeric < question.options.length) {
    dialog.choice = numeric;
    delete dialog.answers[dialog.page];
    if (question.multiSelect) {
      if (dialog.selected.has(numeric)) dialog.selected.delete(numeric); else dialog.selected.add(numeric);
    }
    return "changed";
  }
  const previousChoice = dialog.choice;
  if (matchesKey(data, Key.up)) dialog.choice = Math.max(0, dialog.choice - 1);
  if (matchesKey(data, Key.down)) dialog.choice = Math.min(question.options.length, dialog.choice + 1);
  if (!question.multiSelect && dialog.choice !== previousChoice) delete dialog.answers[dialog.page];
  if (matchesKey(data, Key.space) && question.multiSelect && dialog.choice < question.options.length) {
    delete dialog.answers[dialog.page];
    if (dialog.selected.has(dialog.choice)) dialog.selected.delete(dialog.choice); else dialog.selected.add(dialog.choice);
  }
  if (isEnterKey(data)) {
    if (dialog.choice === question.options.length) editCustom(dialog);
    else return commit(dialog, question.multiSelect
      ? { questionIndex: dialog.page, kind: "multi", optionIndices: [...dialog.selected].sort((a, b) => a - b) }
      : { questionIndex: dialog.page, kind: "option", optionIndex: dialog.choice });
  }
  return "changed";
}
function editQuestionField<K extends string>(form: FormState<K>, data: string): FormState<K> {
  if ([...data].length === 1 && /[\u0080-\u009f]/u.test(data)) return form;
  if (data.startsWith("\x1b[200~") || data.length > 1 && !data.includes("\x1b")) {
    const text = cleanMarkdown(data.replace(/^\x1b\[200~|\x1b\[201~$/g, "")).replace(/[\r\n\t]/g, " ");
    const field = form.fields[form.focus];
    const input = insertText(createTextInput(field.value, field.cursor), text);
    return setValue(form, form.focus, input.value, input.cursor);
  }
  return editField(form, data) ?? form;
}
function saveNote(dialog: QuestionDialog): void {
  dialog.notes[dialog.page] = dialog.noteEditor!.fields.note.value;
  const answer = dialog.answers[dialog.page];
  if (answer) {
    delete answer.notes;
    if (dialog.notes[dialog.page]) answer.notes = dialog.notes[dialog.page];
  }
  dialog.noteEditor = undefined;
}
function commit(dialog: QuestionDialog, answer: AnswerInput): "changed" | "submit" {
  dialog.answers[dialog.page] = { ...answer, ...(dialog.notes[dialog.page] ? { notes: dialog.notes[dialog.page] } : {}) };
  stage(dialog);
  if (dialog.page === dialog.request.params.questions.length - 1) {
    const missing = dialog.request.params.questions.findIndex((_, index) => !dialog.answers[index]);
    if (missing === -1) return "submit";
    showQuestionPage(dialog, missing);
    dialog.error = "First unanswered question; confirm every answer before sending";
  } else showQuestionPage(dialog, dialog.page + 1);
  return "changed";
}
function showQuestionPage(dialog: QuestionDialog, page: number): void {
  stage(dialog);
  dialog.page = page; dialog.custom = undefined; dialog.scroll = 0; dialog.error = undefined; dialog.contextExpanded = false; dialog.originalVisible = false;
  const staged = dialog.staged[page];
  dialog.choice = staged?.choice ?? 0;
  dialog.selected = new Set(staged?.selected);
}

export function formatQuestionText(original: string): { ask: string; conditions: string[]; context: string; original: string } {
  const unchanged = { ask: original, conditions: [], context: "", original };
  // Quoted/code punctuation and URL queries can make sentence boundaries ambiguous.
  if (/(?:`[^`]*(?:\?|[.!]\s)[^`]*`|"[^"]*(?:\?|[.!]\s)[^"]*"|(?<![\p{L}\p{N}])'[^'\n]*(?:\?|[.!]\s)[^'\n]*'(?![\p{L}\p{N}])|\S*:\/\/\S*\?\S*)/u.test(original)) return unchanged;
  const ends = [...original.matchAll(/[.!?](?=\s|$)/gu)].reverse();
  const end = ends.find(match => match[0] === "?");
  if (!end) return unchanged;
  const start = (ends.find(match => match.index < end.index)?.index ?? -1) + 1;
  const before = original.slice(0, start).trimEnd();
  if (/\b(?:\S*\.[\p{L}\p{N}]+|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|dept|Inc|Ltd)\.$/iu.test(before)
    || /\([^)]*[.!?]\s[^)]*\)/u.test(original)) return unchanged;
  const ask = original.slice(start, end.index + 1).trim();
  const context = [original.slice(0, start).trim(), original.slice(end.index + 1).trim()].filter(Boolean).join(" ");
  if (/\(\d+\)/u.test(context)) return unchanged;
  const markers = [...ask.matchAll(/\((\d+)\)\s*/gu)];
  if (!markers.length) return { ask, conditions: [], context, original };
  if (markers.some((match, index) => Number(match[1]) !== index + 1)) return unchanged;
  return { ask: ask.slice(0, markers[0]!.index).trim(), conditions: markers.map((match, index) => ask.slice(match.index, markers[index + 1]?.index).trim()), context, original };
}

const recommendationMarker = /(?<!\S)(?:\(recommended\)|\[recommended\])(?=\s|$|[.,;:!?])/giu;
function displayOption(option: PendingQuestion["params"]["questions"][number]["options"][number]) {
  const label = option.label.replace(recommendationMarker, "").trim();
  const description = option.description.replace(recommendationMarker, "").trim();
  return { label, description, recommended: label !== option.label.trim() || description !== option.description.trim() };
}
function coLocateCatchAll(question: PendingQuestion["params"]["questions"][number]): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/u, "");
  const catchAll = (label: string) => ["other", "change something first", "tell me what to change"].includes(normalize(label));
  const last = question.options.at(-1)!;
  return !question.multiSelect && question.options.filter(option => catchAll(option.label)).length === 1 && catchAll(last.label)
    && !last.preview && last.hasPreview !== true && !displayOption(last).recommended
    && ["", "tell me what to change"].includes(normalize(last.description));
}

/** Body and local keys only. The shared card slot owns identity, geometry and scrolling. */
export function renderQuestionPanel(dialog: QuestionDialog, width: number, theme?: SessionsTheme): RenderCardPanel & { body: string[] } {
  const styled = (text: string) => theme ? styleToken(theme, "muted", text) : text;
  const question = dialog.request.params.questions[dialog.page];
  const body: string[] = [];
  const hangingIndents: number[] = [];
  const focusRows: number[] = [];
  const push = (line: string, hangingIndent = 0, focused = false) => {
    if (focused) focusRows.push(body.length);
    body.push(line); hangingIndents.push(hangingIndent);
  };
  if (dialog.request.params.questions.length > 1) push(styled(`${glyphs.left} ${dialog.request.params.questions.map((q, i) => i === dialog.page ? `[${dialog.answers[i] ? glyphs.progressFilled : glyphs.progressEmpty} ${cleanMarkdown(q.header)}]` : `${dialog.answers[i] ? glyphs.progressFilled : glyphs.progressEmpty} ${cleanMarkdown(q.header)}`).join("   ")} ${glyphs.right}`));
  if (question) {
    const formatted = formatQuestionText(question.question);
    const prose = dialog.originalVisible ? formatted.original : formatted.ask;
    for (const line of cleanMarkdown(prose).split("\n")) push(dialog.originalVisible ? line : `\x1b[1m${line}\x1b[22m`);
    if (!dialog.originalVisible) {
      for (const condition of formatted.conditions) push(cleanMarkdown(condition), visibleWidth(condition.match(/^\(\d+\)\s*/u)?.[0] ?? ""));
      if (formatted.context) {
        push(styled(`C Context ${dialog.contextExpanded ? glyphs.expanded : glyphs.collapsed}`));
        if (dialog.contextExpanded) for (const line of cleanMarkdown(formatted.context).split("\n")) push(line);
      }
    }
    push("");
    if (dialog.noteEditor) {
      push(styled("Question note"));
      const field = dialog.noteEditor.fields.note;
      const chars = [...field.value];
      push(cleanMarkdown(chars.slice(0, field.cursor).join("") + glyphs.cursor + chars.slice(field.cursor).join("")));
    } else if (dialog.custom) {
      const field = dialog.custom.fields.answer;
      push(styled("Type something."));
      const chars = [...field.value];
      for (const line of cleanMarkdown(chars.slice(0, field.cursor).join("") + glyphs.cursor + chars.slice(field.cursor).join("")).split("\n")) push(line);
      if (dialog.notes[dialog.page]) push(styled(`${glyphs.note} ${cleanMarkdown(dialog.notes[dialog.page]!)}`), 2);
    } else {
      const coLocated = coLocateCatchAll(question);
      question.options.forEach((source, index) => {
        const option = displayOption(source);
        const focused = index === dialog.choice;
        const prefix = `${focused ? glyphs.primary : " "} [${index + 1}] ${question.multiSelect ? dialog.selected.has(index) ? `[${glyphs.ready}] ` : "[ ] " : ""}`;
        const custom = coLocated && index === question.options.length - 1
          ? `   ${dialog.choice === question.options.length ? `${glyphs.primary} ` : ""}[${question.options.length + 1}/t] Type something.` : "";
        push(cleanMarkdown(`${prefix}${option.label}${option.recommended ? " [Recommended]" : ""}${custom}`), visibleWidth(prefix), focused || Boolean(custom && dialog.choice === question.options.length));
        if ((width >= 100 || focused) && option.description) push(styled(cleanMarkdown(`${" ".repeat(visibleWidth(prefix))}${option.description}`)), visibleWidth(prefix), focused);
        if (focused && dialog.notes[dialog.page]) push(styled(`  ${glyphs.note} ${cleanMarkdown(dialog.notes[dialog.page]!)}`), 4);
        push("");
      });
      if (!coLocated) {
        const customPrefix = `${dialog.choice === question.options.length ? glyphs.primary : " "} [${question.options.length + 1}] `;
        push(`${customPrefix}Type something.`, visibleWidth(customPrefix), dialog.choice === question.options.length);
      }
      if (dialog.choice === question.options.length && dialog.notes[dialog.page]) push(styled(`  ${glyphs.note} ${cleanMarkdown(dialog.notes[dialog.page]!)}`), 4);
      const option = question.options[dialog.choice];
      if (option?.preview !== undefined) {
        push(styled("Preview"));
        for (const line of cleanMarkdown(option.preview).split("\n")) push(`  ${line}`, 2);
      } else if (option?.hasPreview) push(styled("  preview in Pi"), 2);
    }
  }
  if (!dialog.available) push("Question availability not confirmed; Open in Pi");
  if (dialog.error) push(cleanMarkdown(dialog.error));
  const final = dialog.page === dialog.request.params.questions.length - 1;
  const editing = dialog.custom || dialog.noteEditor;
  const keys = [dialog.noteEditor ? "Enter Save note" : !dialog.custom && question && dialog.choice === question.options.length ? "Enter Type" : final ? "Enter Send" : "Enter Next", `Esc ${editing ? "Options" : "Fleet"}`,
    ...(!editing && question ? [`1${glyphs.range}${question.options.length}${question.multiSelect ? "/Space Toggle" : " Choose"}`, "t Type", "n Note",
      ...(formatQuestionText(question.question).context ? ["C Context"] : []), "O Original"] : []),
    ...(dialog.request.params.questions.length > 1 && !editing ? [`${glyphs.left}/${glyphs.right} Questions`] : []), "PgUp/PgDn Read"];
  return { body, hangingIndents, focusRows, keyLine: dialog.submitting ? `Submitting${glyphs.ellipsis}` : dialog.uncertain ? "Esc Fleet" : keys.join(` ${glyphs.pendingStep} `), offset: dialog.scroll };
}
