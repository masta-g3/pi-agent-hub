// Markdown for agent messages. The parser returns plain data and the renderer builds DOM nodes;
// message text never becomes HTML. Every scan is linear in the message length.

const MAX_DEPTH = 8;       // nested quotes and lists; deeper content stays text
const MAX_URL = 2048;
const MAX_LANG = 32;
const MAX_EMPHASIS = 32;   // open emphasis runs; more stay text, so rendering never recurses deeply
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/u;
const URL_START = /^https?:\/\//iu;
const LINK_START = /^(?:https?:\/\/|mailto:)/iu;
const URL_TRAILING = ".,;:!?'\"*_~";

// ---- inline ----

/** The raw link target when it is an absolute http, https or mailto URL; nothing else is ever clickable. */
function safeHref(raw) {
  if (!LINK_START.test(raw) || raw.length > MAX_URL) return undefined;
  let url;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol === "mailto:") return raw;
  // No login part: "https://bank.example@evil.test" reads as one site and opens another.
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname && !url.username && !url.password && /^https?:\/\/[^/]/iu.test(raw) ? raw : undefined;
}

const isSpace = (char) => char === undefined || char === " " || char === "\n" || char === "\t";

/** Join neighboring text nodes. */
function mergeText(nodes) {
  const merged = [];
  let parts = [];
  const flush = () => { if (parts.length) { merged.push({ type: "text", text: parts.join("") }); parts = []; } };
  for (const node of nodes) {
    if (node.type === "text") parts.push(node.text);
    else { flush(); merged.push(node); }
  }
  flush();
  return merged;
}

/** Index of `char` at or after `from`, looking no further than a URL can reach. */
function findNear(text, char, from) {
  const at = text.slice(from, from + MAX_URL + 2).indexOf(char);
  return at === -1 ? -1 : from + at;
}

/** A link cannot hold a link; an inner one (an image, or a bare URL used as link text) keeps only its text. */
function withoutLinks(nodes) {
  return nodes.flatMap((node) => node.type === "link" ? withoutLinks(node.inline)
    : node.inline ? [{ ...node, inline: withoutLinks(node.inline) }] : [node]);
}

/** `(target)` or `(target "title")` after a closing bracket. */
function linkTarget(text, open) {
  let index = open + 1;
  let raw;
  if (text[index] === "<") {
    const end = findNear(text, ">", index);
    if (end === -1) return undefined;
    raw = text.slice(index + 1, end);
    if (raw.includes("\n")) return undefined;
    index = end + 1;
  } else {
    // Checked before the scan, so text that is not a link costs nothing.
    if (!LINK_START.test(text.slice(index, index + 8))) return undefined;
    const start = index;
    let depth = 0;
    for (; index < text.length && index - start <= MAX_URL; index += 1) {
      const char = text[index];
      if (char === " " || char === "\n" || char === "\t") break;
      if (char === "(") depth += 1;
      else if (char === ")") { if (depth === 0) break; depth -= 1; }
    }
    raw = text.slice(start, index);
  }
  while (text[index] === " ") index += 1;
  const quote = text[index];
  if (quote === '"' || quote === "'") {
    const end = findNear(text, quote, index + 1);
    if (end === -1) return undefined;
    index = end + 1;
    while (text[index] === " ") index += 1;
  }
  if (text[index] !== ")") return undefined;
  const href = safeHref(raw);
  return href ? { href, end: index + 1 } : undefined;
}

export function parseInline(text) {
  const out = [];
  const delimiters = [];                       // open emphasis runs: { char, count, index }
  const open = { "*": 0, _: 0, "~": 0 };       // how many of each are on the stack
  const brackets = [];                         // open "[" or "![": { index, delimiters }
  let plainFrom = 0;
  let index = 0;

  // Where each backtick run starts, by run length, so finding a closing run never rescans the text.
  const ticks = new Map();
  for (let at = text.indexOf("`"); at !== -1; at = text.indexOf("`", at)) {
    let end = at;
    while (text[end] === "`") end += 1;
    const entry = ticks.get(end - at) ?? { starts: [], next: 0 };
    entry.starts.push(at);
    ticks.set(end - at, entry);
    at = end;
  }

  const flush = (to) => { if (to > plainFrom) out.push({ type: "text", text: text.slice(plainFrom, to) }); };
  const popDelimiter = () => { open[delimiters.pop().char] -= 1; };

  function closeEmphasis(char, count) {
    while (count > 0 && open[char] > 0) {
      while (delimiters.at(-1).char !== char) popDelimiter();
      const opener = delimiters.at(-1);
      const use = char === "~" ? 2 : opener.count >= 2 && count >= 2 ? 2 : 1;
      // A bracket opened inside the emphasis can no longer become a link.
      while (brackets.length && brackets.at(-1).index > opener.index) brackets.pop();
      const inline = mergeText(out.splice(opener.index + 1));
      opener.count -= use;
      count -= use;
      if (opener.count) out[opener.index].text = char.repeat(opener.count);
      else { out.length = opener.index; popDelimiter(); }
      out.push({ type: char === "~" ? "del" : use === 2 ? "strong" : "em", inline });
    }
    return count;
  }

  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      const next = text[index + 1];
      if (next === "\n") { flush(index); out.push({ type: "break" }); index += 2; plainFrom = index; }
      else if (next !== undefined && ESCAPABLE.test(next)) { flush(index); plainFrom = index + 1; index += 2; }
      else index += 1;
    } else if (char === "\n") {
      flush(index); out.push({ type: "break" }); index += 1; plainFrom = index;
    } else if (char === "`") {
      let end = index;
      while (text[end] === "`") end += 1;
      // An escaped backtick can leave part of a run here, with a length the index never recorded.
      const entry = ticks.get(end - index) ?? { starts: [], next: 0 };
      while (entry.next < entry.starts.length && entry.starts[entry.next] < end) entry.next += 1;
      const close = entry.starts[entry.next];
      if (close === undefined) { index = end; continue; }
      flush(index);
      let code = text.slice(end, close).replaceAll("\n", " ");
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      out.push({ type: "code", text: code });
      index = plainFrom = close + (end - index);
    } else if (char === "*" || char === "_" || char === "~") {
      let end = index;
      while (text[end] === char) end += 1;
      let count = end - index;
      if (char === "~" && count !== 2) { index = end; continue; }
      const before = text[index - 1];
      const after = text[end];
      const punctBefore = before !== undefined && PUNCTUATION.test(before);
      const punctAfter = after !== undefined && PUNCTUATION.test(after);
      const left = !isSpace(after) && (!punctAfter || isSpace(before) || punctBefore);
      const right = !isSpace(before) && (!punctBefore || isSpace(after) || punctAfter);
      // An underscore inside a word, as in snake_case, is never emphasis.
      const canOpen = char === "_" ? left && (!right || punctBefore) : left;
      const canClose = char === "_" ? right && (!left || punctAfter) : right;
      flush(index);
      if (canClose) count = closeEmphasis(char, count);
      if (count) {
        if (canOpen && delimiters.length < MAX_EMPHASIS) { delimiters.push({ char, count, index: out.length }); open[char] += 1; }
        out.push({ type: "text", text: char.repeat(count) });
      }
      index = plainFrom = end;
    } else if (char === "[" || (char === "!" && text[index + 1] === "[")) {
      flush(index);
      const length = char === "[" ? 1 : 2;
      brackets.push({ index: out.length, delimiters: delimiters.length });
      out.push({ type: "text", text: text.slice(index, index + length) });
      index = plainFrom = index + length;
    } else if (char === "]") {
      const bracket = brackets.pop();
      const target = bracket && text[index + 1] === "(" ? linkTarget(text, index + 1) : undefined;
      if (!target) { index += 1; continue; }
      flush(index);
      while (delimiters.length > bracket.delimiters) popDelimiter();
      const inline = withoutLinks(mergeText(out.splice(bracket.index + 1)));
      out.length = bracket.index;
      out.push({ type: "link", href: target.href, inline });
      brackets.length = 0;
      index = plainFrom = target.end;
    } else if (char === "<") {
      const end = LINK_START.test(text.slice(index + 1, index + 9)) ? findNear(text, ">", index) : -1;
      const raw = end === -1 ? undefined : text.slice(index + 1, end);
      const href = raw !== undefined && !/\s/u.test(raw) ? safeHref(raw) : undefined;
      if (!href) { index += 1; continue; }
      flush(index);
      out.push({ type: "link", href, inline: [{ type: "text", text: raw }] });
      index = plainFrom = end + 1;
    } else if ((char === "h" || char === "H") && URL_START.test(text.slice(index, index + 8)) && !/[\p{L}\p{N}]/u.test(text[index - 1] ?? " ")) {
      let end = index;
      let depth = 0;
      for (; end < text.length && end - index < MAX_URL; end += 1) {
        const at = text[end];
        if (at === " " || at === "\n" || at === "\t" || at === "<" || (at === "]" && brackets.length)) break;
        if (at === "(") depth += 1;
        else if (at === ")") depth -= 1;
      }
      const scanned = end;
      while (end > index && (URL_TRAILING.includes(text[end - 1]) || (text[end - 1] === ")" && depth < 0))) {
        if (text[end - 1] === ")") depth += 1;
        end -= 1;
      }
      const href = safeHref(text.slice(index, end));
      // Text that failed as a URL is skipped whole, so it is never scanned twice.
      if (!href) { index = scanned; continue; }
      flush(index);
      out.push({ type: "link", href, inline: [{ type: "text", text: href }] });
      index = plainFrom = end;
    } else index += 1;
  }
  flush(index);
  return mergeText(out);
}

// ---- blocks ----

const isBlank = (line) => line.trim() === "";

function indentOf(line) {
  let indent = 0;
  for (const char of line) {
    if (char === " ") indent += 1;
    else if (char === "\t") indent += 4;
    else break;
  }
  return indent;
}

function stripIndent(line, columns) {
  let index = 0;
  for (let removed = 0; removed < columns && index < line.length; index += 1) {
    if (line[index] === " ") removed += 1;
    else if (line[index] === "\t") removed += 4;
    else break;
  }
  return line.slice(index);
}

function isRule(line) {
  let mark;
  let count = 0;
  for (const char of line) {
    if (char === " " || char === "\t") continue;
    if (mark === undefined) {
      if (char !== "-" && char !== "*" && char !== "_") return false;
      mark = char;
    } else if (char !== mark) return false;
    count += 1;
  }
  return count >= 3;
}

function fenceOpen(line) {
  // dotAll: "." must also match U+2028 and U+2029, or the pattern backtracks over the run before one.
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/su.exec(line);
  if (!match || (match[2][0] === "`" && match[3].includes("`"))) return undefined;
  return { indent: match[1].length, char: match[2][0], length: match[2].length, lang: match[3].trim().split(/\s/u, 1)[0].slice(0, MAX_LANG) };
}

function fenceClose(line, fence) {
  const mark = line.trim();
  if (mark.length < fence.length) return false;
  for (const char of mark) if (char !== fence.char) return false;
  return true;
}

function heading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/su.exec(line);
  if (!match) return undefined;
  let text = (match[2] ?? "").trimEnd();
  // A closing run of # is decoration when a space comes before it.
  let end = text.length;
  while (text[end - 1] === "#") end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end).trimEnd();
  return { type: "heading", level: match[1].length, inline: parseInline(text) };
}

function listMarker(line) {
  const match = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)/u.exec(line);
  if (!match) return undefined;
  const ordered = match[2].length > 1;
  const content = line.slice(match[0].length);
  const gap = match[3].length;
  return {
    ordered, content, indent: match[1].length, start: ordered ? Number(match[2].slice(0, -1)) : 1,
    contentIndent: match[1].length + match[2].length + (content && gap <= 4 ? gap : 1),
  };
}

const isQuote = (line) => /^ {0,3}>/u.test(line);

function splitRow(line) {
  const row = line.trim();
  const cells = [];
  let cell = "";
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === "\\" && row[index + 1] === "|") { cell += "|"; index += 1; }
    else if (row[index] === "|") { cells.push(cell.trim()); cell = ""; }
    else cell += row[index];
  }
  cells.push(cell.trim());
  if (row.startsWith("|")) cells.shift();
  if (cells.length && cells.at(-1) === "" && row.endsWith("|")) cells.pop();
  return cells;
}

function delimiterRow(line) {
  for (const char of line) if (char !== "-" && char !== "|" && char !== ":" && char !== " " && char !== "\t") return undefined;
  const cells = splitRow(line);
  if (!cells.length || !cells.every((cell) => /^:?-+:?$/u.test(cell))) return undefined;
  return cells.map((cell) => cell.startsWith(":") ? (cell.endsWith(":") ? "center" : "left") : cell.endsWith(":") ? "right" : null);
}

function tableStart(lines, index) {
  if (index + 1 >= lines.length || !lines[index].includes("|")) return undefined;
  const align = delimiterRow(lines[index + 1]);
  if (!align) return undefined;
  const head = splitRow(lines[index]);
  return head.length === align.length ? { head, align } : undefined;
}

function parseBlocks(lines, depth) {
  const blocks = [];
  const nests = depth < MAX_DEPTH;
  const startsBlock = (line) => fenceOpen(line) !== undefined || heading(line) !== undefined || isRule(line) || (nests && isQuote(line));
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) { index += 1; continue; }

    const fence = fenceOpen(line);
    if (fence) {
      const code = [];
      for (index += 1; index < lines.length && !fenceClose(lines[index], fence); index += 1) code.push(stripIndent(lines[index], fence.indent));
      index += 1;
      blocks.push({ type: "code", lang: fence.lang, text: code.join("\n") });
      continue;
    }

    const title = heading(line);
    if (title) { blocks.push(title); index += 1; continue; }

    if (isRule(line)) { blocks.push({ type: "rule" }); index += 1; continue; }

    if (nests && isQuote(line)) {
      const quoted = [];
      for (; index < lines.length && isQuote(lines[index]); index += 1) {
        const rest = lines[index].slice(lines[index].indexOf(">") + 1);
        quoted.push(rest.startsWith(" ") ? rest.slice(1) : rest);
      }
      blocks.push({ type: "quote", blocks: parseBlocks(quoted, depth + 1) });
      continue;
    }

    const table = tableStart(lines, index);
    if (table) {
      const rows = [];
      for (index += 2; index < lines.length && !isBlank(lines[index]) && lines[index].includes("|"); index += 1) {
        const cells = splitRow(lines[index]);
        rows.push(table.align.map((_, column) => parseInline(cells[column] ?? "")));
      }
      blocks.push({ type: "table", head: table.head.map(parseInline), align: table.align, rows });
      continue;
    }

    const first = nests ? listMarker(line) : undefined;
    if (first) {
      const items = [];
      let marker = first;
      while (marker) {
        const item = [marker.content];
        index += 1;
        while (index < lines.length) {
          const next = lines[index];
          if (isBlank(next)) {
            let after = index;
            while (after < lines.length && isBlank(lines[after])) after += 1;
            // Blank lines stay in the item only when indented text follows them.
            if (after === lines.length || indentOf(lines[after]) <= marker.indent) break;
            for (; index < after; index += 1) item.push("");
          } else if (indentOf(next) > marker.indent) {
            item.push(stripIndent(next, marker.contentIndent));
            index += 1;
          } else if (listMarker(next) || startsBlock(next)) break;
          else { item.push(next.trimStart()); index += 1; }   // a wrapped line of the item's paragraph
        }
        items.push(parseBlocks(item, depth + 1));
        let after = index;
        while (after < lines.length && isBlank(lines[after])) after += 1;
        const sibling = after < lines.length && !isRule(lines[after]) ? listMarker(lines[after]) : undefined;
        marker = sibling && sibling.ordered === first.ordered ? sibling : undefined;
        if (marker) index = after;
      }
      blocks.push({ type: "list", ordered: first.ordered, start: first.start, items });
      continue;
    }

    const paragraph = [line.trim()];
    for (index += 1; index < lines.length; index += 1) {
      const next = lines[index];
      if (isBlank(next) || startsBlock(next) || tableStart(lines, index)) break;
      const marker = nests ? listMarker(next) : undefined;
      // A numbered line interrupts a paragraph only as "1.", so a wrapped "2023. It works." stays text.
      if (marker && marker.content && (!marker.ordered || marker.start === 1)) break;
      paragraph.push(next.trim());
    }
    blocks.push({ type: "paragraph", inline: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

/** Message text to blocks. Newlines inside a paragraph are kept as line breaks, as the dashboard shows them. */
export function parseMarkdown(text) {
  return parseBlocks(String(text).replace(/\r\n?/gu, "\n").split("\n"), 0);
}

// ---- DOM ----

function inlineNodes(inline, h) {
  return inline.map((node) => {
    if (node.type === "text") return node.text;
    if (node.type === "code") return h("code", {}, node.text);
    if (node.type === "break") return h("br");
    if (node.type === "link") return h("a", { href: node.href, target: "_blank", rel: "noopener noreferrer" }, inlineNodes(node.inline, h));
    return h(node.type, {}, inlineNodes(node.inline, h));
  });
}

function blockNodes(blocks, h) {
  return blocks.map((block) => {
    if (block.type === "heading") return h(`h${block.level}`, {}, inlineNodes(block.inline, h));
    if (block.type === "paragraph") return h("p", {}, inlineNodes(block.inline, h));
    if (block.type === "rule") return h("hr");
    if (block.type === "quote") return h("blockquote", {}, blockNodes(block.blocks, h));
    if (block.type === "code") {
      // The language stays on the block, so a highlighter can be added without changing the parser.
      return h("div", { class: "md-code", "data-lang": block.lang || undefined },
        block.lang && h("div", { class: "md-lang" }, block.lang),
        h("pre", {}, h("code", {}, block.text)));
    }
    if (block.type === "list") {
      return h(block.ordered ? "ol" : "ul", { start: block.ordered && block.start !== 1 ? block.start : undefined }, block.items.map((item) => h("li", {},
        // A one-paragraph item needs no paragraph box.
        item[0]?.type === "paragraph" ? [inlineNodes(item[0].inline, h), blockNodes(item.slice(1), h)] : blockNodes(item, h))));
    }
    const cell = (tag, inline, column) => h(tag, { class: block.align[column] ? `md-${block.align[column]}` : undefined }, inlineNodes(inline, h));
    return h("div", { class: "md-table" }, h("table", {},
      h("thead", {}, h("tr", {}, block.head.map((inline, column) => cell("th", inline, column)))),
      h("tbody", {}, block.rows.map((row) => h("tr", {}, row.map((inline, column) => cell("td", inline, column)))))));
  });
}

/** DOM nodes for one message. `h` is the page's element builder, which writes text through text nodes only. */
export function renderMarkdown(text, h) {
  return blockNodes(parseMarkdown(text), h);
}
