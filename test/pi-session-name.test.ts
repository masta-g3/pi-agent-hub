import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readPiSessionName } from "../src/core/pi-session-name.js";

async function sessionFile(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-session-name-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

test("readPiSessionName returns the latest trimmed session_info name", async () => {
  const file = await sessionFile([
    JSON.stringify({ type: "session", id: "s1" }),
    JSON.stringify({ type: "session_info", name: " Old name " }),
    "not json",
    JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
    JSON.stringify({ type: "session_info", name: "Pi Name" }),
  ]);

  assert.equal(await readPiSessionName(file), "Pi Name");
});

test("readPiSessionName treats the latest blank name as cleared", async () => {
  const file = await sessionFile([
    JSON.stringify({ type: "session_info", name: "Pi Name" }),
    JSON.stringify({ type: "session_info", name: "   " }),
  ]);

  assert.equal(await readPiSessionName(file), undefined);
});

test("readPiSessionName ignores non-string names", async () => {
  const file = await sessionFile([
    JSON.stringify({ type: "session_info", name: 42 }),
  ]);

  assert.equal(await readPiSessionName(file), undefined);
});
