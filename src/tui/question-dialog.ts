import { glyphs } from "./glyphs.js";
import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { AnswerInput, InteractionTarget, PendingQuestion } from "../core/session-interaction.js";
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
  scroll: number;
  submitting: boolean;
  uncertain: boolean;
  error?: string;
  available: boolean;
}
export function createQuestionDialog(target: InteractionTarget, title: string, request: PendingQuestion, attentionRequestId?: string): QuestionDialog {
  return { target: { ...target }, title, request: structuredClone(request), attentionRequestId,
    answers: [], staged: [], page: 0, choice: 0, selected: new Set(), scroll: 0, submitting: false, uncertain: false, available: true };
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
    if (dialog.custom) { dialog.custom = undefined; return "changed"; }
    return "close";
  }
  if (!dialog.available || dialog.submitting || dialog.uncertain) return "changed";
  const question = dialog.request.params.questions[dialog.page];
  if (!question) return "changed";
  if (dialog.custom) {
    if ([...data].length === 1 && /[\u0080-\u009f]/u.test(data)) return "changed";
    if (isEnterKey(data)) {
      const text = dialog.custom.fields.answer.value.trim();
      if (!text) { dialog.error = "Enter a custom answer"; return "changed"; }
      return commit(dialog, { questionIndex: dialog.page, kind: "custom", text });
    } else if (data.startsWith("\x1b[200~") || data.length > 1 && !data.includes("\x1b")) {
      const text = cleanMarkdown(data.replace(/^\x1b\[200~|\x1b\[201~$/g, "")).replace(/[\r\n\t]/g, " ");
      const field = dialog.custom.fields.answer;
      const input = insertText(createTextInput(field.value, field.cursor), text);
      dialog.custom = setValue(dialog.custom, "answer", input.value, input.cursor);
    } else dialog.custom = editField(dialog.custom, data) ?? dialog.custom;
    return "changed";
  }
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
function commit(dialog: QuestionDialog, answer: AnswerInput): "changed" | "submit" {
  dialog.answers[dialog.page] = answer;
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
  dialog.page = page; dialog.custom = undefined; dialog.scroll = 0; dialog.error = undefined;
  const staged = dialog.staged[page];
  dialog.choice = staged?.choice ?? 0;
  dialog.selected = new Set(staged?.selected);
}

/** Body and local keys only. The shared card slot owns identity, geometry and scrolling. */
export function renderQuestionPanel(dialog: QuestionDialog, width: number, theme?: SessionsTheme): RenderCardPanel & { body: string[] } {
  const styled = (text: string) => theme ? styleToken(theme, "muted", text) : text;
  const question = dialog.request.params.questions[dialog.page];
  const body: string[] = [];
  const hangingIndents: number[] = [];
  const push = (line: string, hangingIndent = 0) => { body.push(line); hangingIndents.push(hangingIndent); };
  if (dialog.request.params.questions.length > 1) push(styled(`${glyphs.left} ${dialog.request.params.questions.map((q, i) => i === dialog.page ? `[${dialog.answers[i] ? glyphs.progressFilled : glyphs.progressEmpty} ${cleanMarkdown(q.header)}]` : `${dialog.answers[i] ? glyphs.progressFilled : glyphs.progressEmpty} ${cleanMarkdown(q.header)}`).join("   ")} ${glyphs.right}`));
  if (question) {
    for (const line of cleanMarkdown(question.question).split("\n")) push(line);
    if (dialog.custom) {
      const field = dialog.custom.fields.answer;
      push(styled("Type something."));
      for (const line of cleanMarkdown(field.value.slice(0, field.cursor) + glyphs.cursor + field.value.slice(field.cursor)).split("\n")) push(line);
    } else {
      question.options.forEach((option, index) => {
        const prefix = `${index === dialog.choice ? glyphs.primary : " "} ${index + 1}. ${question.multiSelect ? dialog.selected.has(index) ? `[${glyphs.ready}] ` : "[ ] " : ""}`;
        push(cleanMarkdown(`${prefix}${option.label}`), visibleWidth(prefix));
        if ((width >= 100 || index === dialog.choice) && option.description) push(styled(cleanMarkdown(`   ${option.description}`)), 3);
      });
      const customPrefix = `${dialog.choice === question.options.length ? glyphs.primary : " "} ${question.options.length + 1}. `;
      push(`${customPrefix}Type something.`, visibleWidth(customPrefix));
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
  const keys = [final ? "Enter Send" : "Enter Next", `Esc ${dialog.custom ? "Options" : "Fleet"}`,
    ...(!dialog.custom && question ? [`1${glyphs.range}${question.options.length}${question.multiSelect ? "/Space Toggle" : " Choose"}`, "t Type"] : []),
    ...(dialog.request.params.questions.length > 1 && !dialog.custom ? [`${glyphs.left}/${glyphs.right} Questions`] : []), "PgUp/PgDn Read"];
  return { body, hangingIndents, keyLine: dialog.submitting ? `Submitting${glyphs.ellipsis}` : dialog.uncertain ? "Esc Fleet" : keys.join(` ${glyphs.pendingStep} `), offset: dialog.scroll };
}
