import test from "node:test";
import assert from "node:assert/strict";

type Inline = { type: string; text?: string; href?: string; inline?: Inline[] };
type Block = { type: string; level?: number; lang?: string; text?: string; ordered?: boolean; start?: number; inline?: Inline[]; blocks?: Block[]; items?: Block[][]; head?: Inline[][]; align?: (string | null)[]; rows?: Inline[][][] };

// The page ships as plain browser modules, so the test loads the same file the phone does.
const { parseMarkdown } = await import(new URL("../../web/markdown.js", import.meta.url).href) as { parseMarkdown(text: string): Block[] };

const t = (text: string): Inline => ({ type: "text", text });
const code = (text: string): Inline => ({ type: "code", text });
const mark = (type: string, ...inline: Inline[]): Inline => ({ type, inline });
const link = (href: string, ...inline: Inline[]): Inline => ({ type: "link", href, inline });
const br: Inline = { type: "break" };
const p = (...inline: Inline[]): Block => ({ type: "paragraph", inline });
const list = (ordered: boolean, start: number, ...items: Block[][]): Block => ({ type: "list", ordered, start, items });

function inlineTypes(nodes: Inline[] = [], found: string[] = []): string[] {
  for (const node of nodes) { found.push(node.type); inlineTypes(node.inline, found); }
  return found;
}
function blockInlineTypes(blocks: Block[], found: string[] = []): string[] {
  for (const block of blocks) {
    inlineTypes(block.inline, found);
    blockInlineTypes(block.blocks ?? [], found);
    for (const item of block.items ?? []) blockInlineTypes(item, found);
    for (const cell of [...(block.head ?? []), ...(block.rows ?? []).flat()]) inlineTypes(cell, found);
  }
  return found;
}

test("headings, paragraphs and line breaks", () => {
  assert.deepEqual(parseMarkdown("# Title\n## Sub ##\n\ntext\n####### seven\n#tag"), [
    { type: "heading", level: 1, inline: [t("Title")] },
    { type: "heading", level: 2, inline: [t("Sub")] },
    p(t("text"), br, t("####### seven"), br, t("#tag")),
  ]);
  // A chat message means its line breaks, so every newline inside a paragraph is kept.
  assert.deepEqual(parseMarkdown("one  \ntwo\\\nthree\nfour\r\n\r\nnext"), [p(t("one"), br, t("two"), br, t("three"), br, t("four")), p(t("next"))]);
});

test("emphasis, strikethrough and code spans", () => {
  assert.deepEqual(parseMarkdown("**bold** *em* _em_ __bold__ ~~gone~~ `code` ***both***"), [p(
    mark("strong", t("bold")), t(" "), mark("em", t("em")), t(" "), mark("em", t("em")), t(" "), mark("strong", t("bold")), t(" "),
    mark("del", t("gone")), t(" "), code("code"), t(" "), mark("em", mark("strong", t("both"))),
  )]);
  assert.deepEqual(parseMarkdown("**bold with *em* and `c*d`** then *em with **strong** inside*"), [p(
    mark("strong", t("bold with "), mark("em", t("em")), t(" and "), code("c*d")), t(" then "),
    mark("em", t("em with "), mark("strong", t("strong")), t(" inside")),
  )]);
  assert.deepEqual(parseMarkdown("``a`b`` and ` x ` and `open"), [p(code("a`b"), t(" and "), code("x"), t(" and `open"))]);
  // An escaped backtick splits a run. As in CommonMark, the rest of the run can still open a span.
  assert.deepEqual(parseMarkdown("\\`` a `b"), [p(t("`"), code("a"), t("b"))]);
  assert.deepEqual(parseMarkdown("\\``` a"), [p(t("``` a"))]);
});

test("text that only looks like emphasis stays literal", () => {
  for (const text of ["snake_case_name and a_b_c", "2 * 3 * 4", "*args, **kwargs", "a ~ b ~5 min", "5 * (3 + 4) * 2", "file_a.ts and file_b.ts"]) {
    assert.deepEqual(parseMarkdown(text), [p(t(text))], text);
  }
  assert.deepEqual(parseMarkdown("\\*not em\\* \\# a\\b \\[x\\](y)"), [p(t("*not em* # a\\b [x](y)"))]);
});

test("fenced code keeps its text and language", () => {
  assert.deepEqual(parseMarkdown("```ts\nconst a = 1;\n\n  **b**\n```\nafter"), [{ type: "code", lang: "ts", text: "const a = 1;\n\n  **b**" }, p(t("after"))]);
  assert.deepEqual(parseMarkdown("```\nplain\n```"), [{ type: "code", lang: "", text: "plain" }]);
  assert.deepEqual(parseMarkdown("~~~sh extra\nx\ny"), [{ type: "code", lang: "sh", text: "x\ny" }]);
  assert.deepEqual(parseMarkdown("````md\n```\nx\n```\n````"), [{ type: "code", lang: "md", text: "```\nx\n```" }]);
  assert.deepEqual(parseMarkdown("text\n```\n\tcode\n```"), [p(t("text")), { type: "code", lang: "", text: "\tcode" }]);
});

test("ordered, unordered and nested lists", () => {
  assert.deepEqual(parseMarkdown("- a\n- b\n  - c\n  - d\n- e"), [
    list(false, 1, [p(t("a"))], [p(t("b")), list(false, 1, [p(t("c"))], [p(t("d"))])], [p(t("e"))]),
  ]);
  assert.deepEqual(parseMarkdown("3. one\n4. two\n   - sub\n     more\n5. three"), [
    list(true, 3, [p(t("one"))], [p(t("two")), list(false, 1, [p(t("sub"), br, t("more"))])], [p(t("three"))]),
  ]);
  // Sub-bullets indented less than the item text still nest.
  assert.deepEqual(parseMarkdown("1. one\n  - sub\n2. two"), [list(true, 1, [p(t("one")), list(false, 1, [p(t("sub"))])], [p(t("two"))])]);
  assert.deepEqual(parseMarkdown("* a\nlazy\n\n* b\n\ntext"), [list(false, 1, [p(t("a"), br, t("lazy"))], [p(t("b"))]), p(t("text"))]);
  assert.deepEqual(parseMarkdown("- item\n\n  ```js\n  x\n\n  y\n  ```\n- next"), [
    list(false, 1, [p(t("item")), { type: "code", lang: "js", text: "x\n\ny" }], [p(t("next"))]),
  ]);
  // A year at the start of a wrapped line is not a list.
  assert.deepEqual(parseMarkdown("Released in\n2023. It works."), [p(t("Released in"), br, t("2023. It works."))]);
});

test("block quotes and rules", () => {
  assert.deepEqual(parseMarkdown("> quoted **x**\n> more\n>> inner\n\nafter"), [
    { type: "quote", blocks: [p(t("quoted "), mark("strong", t("x")), br, t("more")), { type: "quote", blocks: [p(t("inner"))] }] },
    p(t("after")),
  ]);
  assert.deepEqual(parseMarkdown("a\n\n---\n***\n- - -\nb"), [p(t("a")), { type: "rule" }, { type: "rule" }, { type: "rule" }, p(t("b"))]);
});

test("tables keep alignment and cell formatting", () => {
  assert.deepEqual(parseMarkdown("| Name | Count | Mid |\n|:-----|------:|:---:|\n| a | 1 | x |\n| `b\\|c` | **2** |\n\nafter"), [
    { type: "table", head: [[t("Name")], [t("Count")], [t("Mid")]], align: ["left", "right", "center"],
      rows: [[[t("a")], [t("1")], [t("x")]], [[code("b|c")], [mark("strong", t("2"))], []]] },
    p(t("after")),
  ]);
  assert.deepEqual(parseMarkdown("a | b\n--- | ---\n1 | 2"), [{ type: "table", head: [[t("a")], [t("b")]], align: [null, null], rows: [[[t("1")], [t("2")]]] }]);
  assert.deepEqual(parseMarkdown("a | b\nplain"), [p(t("a | b"), br, t("plain"))]);
  assert.deepEqual(parseMarkdown("a | b | c\n--- | ---"), [p(t("a | b | c"), br, t("--- | ---"))]);
});

test("links, bare URLs and images", () => {
  assert.deepEqual(parseMarkdown("[site](https://example.com/a_b) and https://x.dev/path_one. Also <https://y.dev>, (see https://z.dev/a)"), [p(
    link("https://example.com/a_b", t("site")), t(" and "), link("https://x.dev/path_one", t("https://x.dev/path_one")), t(". Also "),
    link("https://y.dev", t("https://y.dev")), t(", (see "), link("https://z.dev/a", t("https://z.dev/a")), t(")"),
  )]);
  assert.deepEqual(parseMarkdown("[**bold** link](https://e.com \"Title\") [w](https://en.wikipedia.org/wiki/A_(b)) [mail](mailto:a@b.co)"), [p(
    link("https://e.com", mark("strong", t("bold")), t(" link")), t(" "), link("https://en.wikipedia.org/wiki/A_(b)", t("w")), t(" "), link("mailto:a@b.co", t("mail")),
  )]);
  // An image is never fetched: it shows as a link named by its alt text.
  assert.deepEqual(parseMarkdown("![diagram](https://e.com/a.png)"), [p(link("https://e.com/a.png", t("diagram")))]);
  assert.deepEqual(parseMarkdown("[https://e.com](https://e.com) **[b](HTTPS://E.com)**"), [p(
    link("https://e.com", t("https://e.com")), t(" "), mark("strong", link("HTTPS://E.com", t("b"))),
  )]);
  assert.deepEqual(parseMarkdown("[not a link] and [x] (y) and [a](<https://e.com/a b>)"), [p(t("[not a link] and [x] (y) and "), link("https://e.com/a b", t("a")))]);
});

test("only http, https and mailto links become links", () => {
  assert.deepEqual(parseMarkdown("[x](javascript:alert(1))"), [p(t("[x](javascript:alert(1))"))]);
  for (const text of [
    "[x](JaVaScRiPt:alert(1))", "[x]( javascript:alert(1))", "[x](\u0001javascript:alert(1))", "[x](java\tscript:alert(1))", "[x](java\nscript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)", "[x](vbscript:msgbox(1))", "[x](//evil.example/a)", "[x](/relative/path)", "[x](docs/FILE.md)",
    "[x](file:///etc/passwd)", "<javascript:alert(1)>", "javascript:alert(1)", "![x](javascript:alert(1))", "[x](<javascript:alert(1)>)", "[x](https:evil)",
    // A name before "@" is a login, not the site: the link would open the host after it.
    "[docs.example.com](https://docs.example.com@evil.test/)", "https://bank.example@evil.test/login", "<https://user:pass@evil.test>", "[x](https://bank.example%2Fpath@evil.test)",
  ]) {
    const types = blockInlineTypes(parseMarkdown(text));
    assert.equal(types.includes("link"), false, text);
  }
});

test("raw HTML is text", () => {
  assert.deepEqual(parseMarkdown("<img src=x onerror=alert(1)>\n\n<script>alert(1)</script> <b>bold</b> &amp;"), [
    p(t("<img src=x onerror=alert(1)>")), p(t("<script>alert(1)</script> <b>bold</b> &amp;")),
  ]);
});

test("nesting deeper than eight levels becomes text", () => {
  const depth = (blocks: Block[], type: string, key: "blocks" | "items"): number => {
    const inner = blocks.find((block) => block.type === type);
    if (!inner) return 0;
    return 1 + depth(key === "blocks" ? inner.blocks! : inner.items![0]!, type, key);
  };
  assert.equal(depth(parseMarkdown(`${">".repeat(12)} deep`), "quote", "blocks"), 8);
  assert.equal(depth(parseMarkdown(`${"- ".repeat(12)}deep`), "list", "items"), 8);
  assert.match(JSON.stringify(parseMarkdown(`${">".repeat(12)} deep`)), /"text":">>>> deep"/u);
});

test("emphasis nests to a fixed depth", () => {
  const depth = (nodes: Inline[]): number => Math.max(0, ...nodes.map((node) => node.inline ? 1 + depth(node.inline) : 0));
  const blocks = parseMarkdown(`${"*a ".repeat(500)}${"a* ".repeat(500)}`);
  assert.equal(depth(blocks[0]!.inline!), 32);
});

test("random input never throws and never yields an unsafe link", () => {
  const alphabet = ["*", "_", "~", "`", "[", "]", "(", ")", "!", "<", ">", "\\", "\n", " ", "-", "1.", "|", ":", "#", "a", "b", "http://x.y", "javascript:", "https://", "mailto:a@b", "\t", "  ", "```", "\"", "'"];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const hrefs = (value: unknown, found: string[] = []): string[] => {
    if (Array.isArray(value)) for (const entry of value) hrefs(entry, found);
    else if (value && typeof value === "object") {
      const node = value as Inline;
      if (node.type === "link") found.push(node.href!);
      for (const entry of Object.values(node)) hrefs(entry, found);
    }
    return found;
  };
  let links = 0;
  for (let run = 0; run < 20_000; run += 1) {
    let text = "";
    for (let length = 1 + Math.floor(random() * 60); length > 0; length -= 1) text += alphabet[Math.floor(random() * alphabet.length)];
    for (const href of hrefs(parseMarkdown(text))) {
      links += 1;
      assert.match(href, /^(?:https?:\/\/[^/]|mailto:)/iu, JSON.stringify(text));
    }
  }
  assert.ok(links > 100, "the mix must produce links to check");
});

test("hostile long input parses in linear time", () => {
  const size = 64 * 1024;
  const fill = (unit: string) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const cases = [
    "*", "a*", "*a ", "**a ", "_a ", "~~a ", "[", "a[", "[a](", "](", "[a](b", "![", "`", "a`", "a ` b `` c ``` ", ">", "- ", "1. ", "| ", "|-", "\\", "<", "<http://", "[a](<", "[a](http://x \"", "http://", " ", "# ", "\t",
    "*a **b ", "[*a ", "a\n", "- a\n", "> a\n", "| a | b |\n", "```\n",
  ];
  for (const unit of [...cases, ...cases.map((unit) => `x ${unit}`)]) {
    for (const text of [fill(unit), `# ${fill(unit)}`, `a\n--- ${fill(unit)}x`]) {
      // Best of three, so a busy machine does not fail a linear parse.
      let best = Infinity;
      for (let run = 0; run < 3 && best >= 200; run += 1) {
        const start = performance.now();
        parseMarkdown(text);
        best = Math.min(best, performance.now() - start);
      }
      assert.ok(best < 200, `${JSON.stringify(unit)} took ${Math.round(best)} ms`);
    }
  }
  // U+2028 and U+2029 are not line ends here, and "." does not match them: a pattern must not backtrack over the run before one.
  for (const separator of ["\u2028", "\u2029"]) {
    for (const text of [`${"`".repeat(size)}${separator}`, `${"~".repeat(size)}${separator}`, `# ${" ".repeat(size)}${separator}x`, `text\n${"`".repeat(size)}${separator}x`, `- ${"`".repeat(size)}${separator}`]) {
      const start = performance.now();
      parseMarkdown(text);
      const took = performance.now() - start;
      assert.ok(took < 200, `${JSON.stringify(text.slice(0, 3))}… before ${JSON.stringify(separator)} took ${Math.round(took)} ms`);
    }
  }
  assert.deepEqual(parseMarkdown("# Title\u2028rest"), [{ type: "heading", level: 1, inline: [t("Title\u2028rest")] }]);
});
