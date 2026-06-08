import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionMetadataPath } from "../src/core/paths.js";
import { readSessionMetadata } from "../src/core/session-metadata.js";

async function withTempHub(fn: (dir: string) => Promise<void>): Promise<void> {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-metadata-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
}

test("sessionMetadataPath points beside heartbeat state", async () => {
  await withTempHub(async (dir) => {
    assert.equal(sessionMetadataPath("abc"), join(dir, "session-metadata", "abc.json"));
  });
});

test("readSessionMetadata accepts generic known metadata fields from any source", async () => {
  await withTempHub(async (dir) => {
    await mkdir(join(dir, "session-metadata"), { recursive: true });
    await writeFile(join(dir, "session-metadata", "abc.json"), `${JSON.stringify({
      source: "any-extension",
      goal: "Ship dashboard metadata.",
      status: "Parser implemented.",
      nextStep: "Render it in details.",
      stage: "implementing",
      confidence: 0.8,
      updatedAt: 123,
      ignored: "field",
    })}\n`, "utf8");

    assert.deepEqual(await readSessionMetadata("abc"), {
      source: "any-extension",
      goal: "Ship dashboard metadata.",
      status: "Parser implemented.",
      nextStep: "Render it in details.",
      stage: "implementing",
      confidence: 0.8,
      updatedAt: 123,
    });
  });
});

test("readSessionMetadata ignores missing malformed fieldless or low-confidence files", async () => {
  await withTempHub(async (dir) => {
    await mkdir(join(dir, "session-metadata"), { recursive: true });
    await writeFile(join(dir, "session-metadata", "bad-json.json"), "{", "utf8");
    await writeFile(join(dir, "session-metadata", "fieldless.json"), JSON.stringify({ source: "any-extension", ignored: "x" }), "utf8");
    await writeFile(join(dir, "session-metadata", "low-confidence.json"), JSON.stringify({ goal: "Maybe wrong", confidence: 0.49 }), "utf8");

    assert.equal(await readSessionMetadata("missing"), undefined);
    assert.equal(await readSessionMetadata("bad-json"), undefined);
    assert.equal(await readSessionMetadata("fieldless"), undefined);
    assert.equal(await readSessionMetadata("low-confidence"), undefined);
  });
});
