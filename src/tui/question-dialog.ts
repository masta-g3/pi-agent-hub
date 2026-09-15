import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AnswerInput, InteractionTarget, PendingQuestion } from "../core/session-interaction.js";
import { createForm, editField, setValue, type FormState } from "./form.js";
import { renderForm } from "./layout.js";
import { createTextInput, insertText, isEnterKey } from "./text-input.js";
import { cleanMarkdown, renderMarkdown } from "./conversation.js";
import { styleToken, styleBgToken, type SessionsTheme } from "./theme.js";

export interface QuestionDialog {
  target: InteractionTarget;
  title: string;
  request: PendingQuestion;
  attentionRequestId?: string;
  answers: AnswerInput[];
  page: number;
  choice: number;
  selected: Set<number>;
  custom?: FormState<"answer">;
  scroll: number;
  pageSize: number;
  revealChoice: boolean;
  submitting: boolean;
  uncertain: boolean;
  error?: string;
  usable: boolean;
  available: boolean;
  rowTargets: (number | "submit" | "next" | "back" | undefined)[];
}
export function createQuestionDialog(target: InteractionTarget, title: string, request: PendingQuestion, attentionRequestId?: string): QuestionDialog {
  return { target: { ...target }, title, request: structuredClone(request), attentionRequestId,
    answers: [], page: 0, choice: 0, selected: new Set(), scroll: 0, pageSize: 1, revealChoice: true, submitting: false, uncertain: false, usable: true, available: true, rowTargets: [] };
}
export function handleQuestionInput(dialog: QuestionDialog, data: string): "changed" | "close" | "submit" {
  if (matchesKey(data, Key.escape)) return dialog.submitting ? "changed" : "close";
  if (!dialog.usable || !dialog.available || dialog.submitting || dialog.uncertain) return "changed";
  const question = dialog.request.params.questions[dialog.page];
  if (matchesKey(data, Key.pageUp)) { dialog.scroll = Math.max(0, dialog.scroll - dialog.pageSize); return "changed"; }
  if (matchesKey(data, Key.pageDown)) { dialog.scroll += dialog.pageSize; return "changed"; }
  if (matchesKey(data, Key.left) && !dialog.custom) {
    showQuestionPage(dialog, Math.max(0, dialog.page - 1));
    return "changed";
  }
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
  const numeric = /^[1-9]$/.test(data) ? Number(data) - 1 : -1;
  if (numeric >= 0 && numeric < question.options.length) {
    dialog.choice = numeric; dialog.revealChoice = true;
    if (question.multiSelect) {
      if (dialog.selected.has(numeric)) dialog.selected.delete(numeric); else dialog.selected.add(numeric);
    }
    return "changed";
  }
  if (data === "t") { dialog.custom = createForm([{ key: "answer", label: "Answer", value: "", hint: "Your custom answer" }]); dialog.revealChoice = true; return "changed"; }
  if (matchesKey(data, Key.up)) { dialog.choice = Math.max(0, dialog.choice - 1); dialog.revealChoice = true; }
  if (matchesKey(data, Key.down)) { dialog.choice = Math.min(question.options.length, dialog.choice + 1); dialog.revealChoice = true; }
  if (matchesKey(data, Key.space) && question.multiSelect && dialog.choice < question.options.length) {
    if (dialog.selected.has(dialog.choice)) dialog.selected.delete(dialog.choice); else dialog.selected.add(dialog.choice);
  }
  if (isEnterKey(data)) {
    if (dialog.choice === question.options.length) { dialog.custom = createForm([{ key: "answer", label: "Answer", value: "", hint: "Your custom answer" }]); dialog.revealChoice = true; }
    else return commit(dialog, question.multiSelect
      ? { questionIndex: dialog.page, kind: "multi", optionIndices: [...dialog.selected].sort((a, b) => a - b) }
      : { questionIndex: dialog.page, kind: "option", optionIndex: dialog.choice });
  }
  return "changed";
}
function commit(dialog: QuestionDialog, answer: AnswerInput): "changed" | "submit" {
  dialog.answers[dialog.page] = answer;
  if (dialog.page === dialog.request.params.questions.length - 1) return "submit";
  showQuestionPage(dialog, dialog.page + 1);
  return "changed";
}
function showQuestionPage(dialog: QuestionDialog, page: number): void {
  dialog.page = page; dialog.revealChoice = true; dialog.choice = 0; dialog.selected.clear(); dialog.custom = undefined; dialog.scroll = 0; dialog.error = undefined;
  const previous = dialog.answers[page];
  if (previous?.kind === "option") dialog.choice = previous.optionIndex;
  else if (previous?.kind === "multi") dialog.selected = new Set(previous.optionIndices);
  else if (previous?.kind === "custom") dialog.custom = createForm([{ key: "answer", label: "Answer", value: previous.text }]);
}
export function renderQuestionDialog(dialog: QuestionDialog, width: number, height: number, theme?: SessionsTheme, focused = true): string[] {
  dialog.rowTargets = [];
  dialog.usable = width >= 40 && height >= 6;
  if (!dialog.usable) return [truncateToWidth(`${dialog.title} · Resize to answer (40 × 6 minimum)`, width)];
  const question = dialog.request.params.questions[dialog.page];
  const position = `Question ${Math.min(dialog.page + 1, dialog.request.params.questions.length)} of ${dialog.request.params.questions.length}`;
  const heading = `? ANSWER NEEDED · ${position}`;
  const rows: { text: string; target?: number | "submit" | "back"; field?: boolean }[] = [];
  if (question) {
    rows.push(...renderMarkdown(question.question, width, theme).map(text => ({ text })));
    if (dialog.custom) {
      rows.push(...renderForm({ title: "Custom answer", fields: Object.values(dialog.custom.fields), focus: "answer", footer: "Enter Next · Esc Back to reading" }, width, theme).map(text => ({ text, field: text.includes("▎") })));
    } else {
      const choices = [...question.options.map((option, index) => ({ text: `${index === dialog.choice ? "▎" : " "} ${index + 1} ${question.multiSelect ? dialog.selected.has(index) ? "[✓] " : "[ ] " : ""}${option.label} — ${option.description}`, target: index })), { text: `${dialog.choice === question.options.length ? "▎" : " "} t Type something…`, target: question.options.length }];
      const preview = question.options[dialog.choice]?.preview;
      if (preview && width >= 80) {
        const left = Math.floor(width / 2) - 1;
        const right = renderMarkdown(preview, width - left - 3, theme);
        const wrapped = choices.flatMap(choice => wrapTextWithAnsi(cleanMarkdown(choice.text), left).map(text => ({ text, target: choice.target })));
        for (let i = 0; i < Math.max(wrapped.length, right.length); i++) {
          const text = wrapped[i]?.text ?? "";
          rows.push({ text: `${text}${" ".repeat(Math.max(0, left - visibleWidth(text)))} │ ${right[i] ?? ""}`, target: wrapped[i]?.target });
        }
      } else {
        rows.push(...choices.flatMap(choice => wrapTextWithAnsi(cleanMarkdown(choice.text), width).map(text => ({ text, target: choice.target }))));
        if (preview) rows.push({ text: "Preview" }, ...renderMarkdown(preview, width, theme).map(text => ({ text })));
      }
    }
  }
  const capacity = height - 4;
  dialog.pageSize = Math.max(1, capacity - 1);
  dialog.scroll = Math.min(dialog.scroll, Math.max(0, rows.length - capacity));
  if (question && dialog.revealChoice) {
    dialog.revealChoice = false;
    const focused = rows.findIndex(row => dialog.custom ? row.field : row.target === dialog.choice);
    if (focused >= 0 && (focused < dialog.scroll || focused >= dialog.scroll + capacity)) dialog.scroll = Math.max(0, focused - capacity + 1);
  }
  const visible = rows.slice(dialog.scroll, dialog.scroll + capacity);
  const status = dialog.submitting ? "Submitting…" : dialog.uncertain ? "Delivery not confirmed; checking Pi before retrying" : !dialog.available ? "Question availability not confirmed; Open in Pi" : dialog.error ?? "PgUp/PgDn Read · ← Previous question";
  const final = dialog.page === dialog.request.params.questions.length - 1;
  const footer = !focused ? "Tab Answer · c Hide" : dialog.custom ? `${final ? "Enter Send" : "Enter Next"} · Editing answer` : `${final ? "Enter Send" : "Enter Next"}${question?.multiSelect ? " · Numbers/Space Toggle" : ` · 1–${question?.options.length} Choose`} · t Type`;
  dialog.rowTargets = [undefined, ...visible.map(row => row.target), undefined, !dialog.submitting && !dialog.uncertain && dialog.available ? final ? "submit" : "next" : undefined, "back"];
  const styled = (token: "accent" | "dim" | "error" | "warning", text: string) => theme ? styleToken(theme, token, text) : text;
  return [styled("warning", heading), ...visible.map(row => theme && row.target === dialog.choice ? styleBgToken(theme, "selectedBg", row.text) : row.text), styled(dialog.error ? "error" : "dim", status), styled("accent", footer), styled("dim", "Esc Fleet · Tab Focus")].map(line => truncateToWidth(line, width));
}
