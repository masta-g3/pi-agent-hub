import { conversationDashboardFooter } from "./dashboard-commands.js";
import { Markdown, truncateToWidth, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { conversationText as cleanMarkdown, type ConversationItem, type ConversationPage } from "../core/conversation.js";
import { sameInteractionTarget, type InteractionTarget, type SessionInteractionState } from "../core/session-interaction.js";
import { styleToken, type SessionsTheme, type ThemeToken } from "./theme.js";

export { conversationText as cleanMarkdown } from "../core/conversation.js";

export function renderMarkdown(text: string, width: number, theme?: SessionsTheme): string[] {
  const token = (name: ThemeToken) => (value: string) => theme ? styleToken(theme, name, value) : value;
  const normal = token("text");
  const markdownTheme: MarkdownTheme = {
    heading: token("accent"), link: normal, linkUrl: token("dim"), code: normal, codeBlock: normal,
    codeBlockBorder: token("border"), quote: normal, quoteBorder: token("border"), hr: token("border"),
    listBullet: token("accent"), bold: normal, italic: normal, strikethrough: normal, underline: normal,
  };
  return new Markdown(cleanMarkdown(text), 0, 0, markdownTheme, { color: normal }).render(Math.max(1, width))
    .map(line => truncateToWidth(line, Math.max(1, width)));
}

/** One selected identity, one request in flight. No timer or transcript persistence. */
export class SelectedInteractionObserver {
  target?: InteractionTarget;
  state?: SessionInteractionState;
  error?: string;
  private inFlight = false;
  private generation = 0;
  private observedAt = -Infinity;
  setTarget(target?: InteractionTarget): void {
    if (sameInteractionTarget(this.target, target)) return;
    this.target = target;
    this.state = undefined;
    this.error = undefined;
    this.observedAt = -Infinity;
    this.generation++;
  }
  invalidate(): void { this.observedAt = -Infinity; }
  async poll(now: number, readState: (target: InteractionTarget) => Promise<SessionInteractionState>, read?: (target: InteractionTarget) => Promise<void>): Promise<void> {
    if (!this.target || this.inFlight || now - this.observedAt < 1000) return;
    const target = this.target;
    const generation = this.generation;
    this.inFlight = true;
    this.observedAt = now;
    try {
      const state = await readState(target);
      if (generation !== this.generation) return;
      this.state = state;
      this.error = undefined;
      if (read) await read(target);
    } catch (error) {
      if (generation === this.generation) {
        this.state = undefined;
        this.error = error instanceof Error ? error.message : String(error);
      }
    } finally { this.inFlight = false; }
  }
}

interface TranscriptLine { id: string; offset: number; text: string }
export class ConversationReader {
  items: ConversationItem[] = [];
  branchId?: string;
  before?: string;
  anchor?: { id: string; offset: number };
  following = true;
  newMessages = false;
  private lines: TranscriptLine[] = [];
  private top = 0;
  private height = 1;
  private revealId?: string;
  clear(): void {
    this.items = []; this.branchId = undefined; this.before = undefined; this.anchor = undefined;
    this.following = true; this.newMessages = false; this.lines = []; this.top = 0; this.revealId = undefined;
  }
  accept(page: ConversationPage, older = false): void {
    if (this.branchId && this.branchId !== page.branchId) this.clear();
    const existing = new Set(this.items.map(item => item.id));
    const added = page.items.filter(item => !existing.has(item.id));
    if (!older && this.items.length && added.length > 0 && page.before !== undefined && added.length === page.items.length) {
      // A missed page must stay reloadable; never splice a gap into the transcript.
      if (!this.following) { this.newMessages = true; return; }
      this.clear();
      this.revealId = page.items[0]?.id;
    }
    if (!older && added.length && this.items.length) {
      if (this.following) this.revealId = added[0]!.id;
      else this.newMessages = true;
    }
    this.branchId = page.branchId;
    if (older || !this.items.length) this.before = page.before;
    const updates = new Map(page.items.map(item => [item.id, item]));
    this.items = this.items.map(item => updates.get(item.id) ?? item);
    this.items = older ? [...added, ...this.items] : [...this.items, ...added];
    let bytes = this.items.reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0);
    // Evict away from the visible anchor. The first retained stable item is a reloadable cursor.
    while (bytes > 1024 * 1024 && this.items.length > 1) {
      const evictNewest = this.anchor?.id === this.items[0]?.id || older && this.items.at(-1)?.id !== this.anchor?.id;
      const removed = evictNewest ? this.items.pop()! : this.items.shift()!;
      bytes -= Buffer.byteLength(removed.text, "utf8");
      if (!evictNewest) this.before = this.items[0]?.id;
    }
  }
  scroll(delta: number): void {
    this.following = false;
    this.top = Math.max(0, Math.min(Math.max(0, this.lines.length - this.height), this.top + delta));
    const line = this.lines[this.top];
    if (line) this.anchor = { id: line.id, offset: line.offset };
  }
  home(): void { this.scroll(-Infinity); }
  end(): void { this.following = true; this.anchor = undefined; this.revealId = undefined; this.newMessages = false; }
  get atTop(): boolean { return this.top === 0; }
  get pageSize(): number { return Math.max(1, this.height - 1); }
  render(width: number, height: number, theme?: SessionsTheme, inlineToolCallId?: string): string[] {
    this.height = Math.max(1, height);
    const labels = { user: "YOU", assistant: "PI", question: "PI · QUESTION", answer: "YOU · ANSWER" };
    const bodyWidth = Math.max(1, width - 2);
    this.lines = this.items.filter(item => !inlineToolCallId || item.role !== "question" || item.toolCallId !== inlineToolCallId).flatMap(item => [labels[item.role], ...renderMarkdown(item.text, bodyWidth, theme), ...(item.truncated && !item.text.includes("Content shortened — Open in Pi") ? ["Content shortened — Open in Pi"] : []), ""]
      .map((text, offset) => {
        let line = text ? truncateToWidth(`  ${text}`, width) : "";
        if (offset === 0) {
          const label = `${line} `;
          line = truncateToWidth(label + "─".repeat(Math.max(0, width - visibleWidth(label))), width);
          if (theme) line = styleToken(theme, item.role === "user" || item.role === "answer" ? "accent" : "success", line);
        }
        return { id: item.id, offset, text: line };
      }));
    if (this.following) {
      const start = this.revealId ? this.lines.findIndex(line => line.id === this.revealId) : -1;
      this.top = start >= 0 ? start : Math.max(0, this.lines.length - this.height);
    } else if (this.anchor) {
      const start = this.lines.findIndex(line => line.id === this.anchor!.id && line.offset === this.anchor!.offset);
      if (start >= 0) this.top = start;
      else this.top = Math.min(this.top, Math.max(0, this.lines.length - this.height));
    }
    const visible = this.lines.slice(this.top, this.top + this.height);
    const first = visible.find(line => line.text.trim());
    if (first && first.offset > 0) {
      const speaker = this.lines.find(line => line.id === first.id && line.offset === 0)!;
      return [speaker.text, ...visible.map(line => line.text)].slice(0, this.height);
    }
    return visible.map(line => line.text);
  }
}

export function renderConversationHeading(title: string, width: number, theme?: SessionsTheme): string {
  const label = `── ${truncateToWidth(cleanMarkdown(title), Math.max(0, width - 6))} `;
  const line = truncateToWidth(label + "─".repeat(Math.max(0, width - visibleWidth(label))), width);
  return theme ? styleToken(theme, "dim", line) : line;
}

/** Render the full-width transcript and its catalog actions. */
export function renderConversationPane(input: {
  width: number; height: number;
  title: string; transcript: readonly string[]; transcriptHeight: number; status: string;
  actions: readonly { id: string; label: string }[]; focusedAction: string;
}, theme?: SessionsTheme): { lines: string[]; actionRows: (string | undefined)[] } {
  const styled = (token: ThemeToken, value: string) => theme ? styleToken(theme, token, value) : value;
  const content = [renderConversationHeading(input.title, input.width, theme),
    ...Array.from({ length: input.transcriptHeight }, (_, index) => input.transcript[index] ?? ""),
    styled(input.status.startsWith("?") ? "warning" : "dim", cleanMarkdown(input.status)),
    ...input.actions.map((command, index) => styled(command.id === input.focusedAction ? "accent" : "text", `${command.id === input.focusedAction ? "▎" : index === 0 ? "▶" : " "} ${cleanMarkdown(command.label)}`)),
    styled("dim", conversationDashboardFooter()),
  ].slice(0, input.height);
  const actionRows: (string | undefined)[] = content.map(() => undefined);
  for (let index = 0; index < input.actions.length; index++) {
    const row = input.transcriptHeight + 2 + index;
    if (row < content.length) actionRows[row] = input.actions[index]!.id;
  }
  return { actionRows, lines: content.map(line => truncateToWidth(line, input.width)) };
}
