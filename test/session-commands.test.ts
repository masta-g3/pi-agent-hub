import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRegistry } from "../src/core/registry.js";
import { forkManagedSession, managedPiCommand } from "../src/app/session-commands.js";
import type { ManagedSession } from "../src/core/types.js";

test("managedPiCommand keeps the existing plain command without prelude", () => {
  assert.equal(managedPiCommand({ piArgs: ["--extension", "/tmp/ext path/index.js"] }), "pi '--extension' '/tmp/ext path/index.js'");
});

test("managedPiCommand wraps prelude before exec and gates on its final status", () => {
  const command = managedPiCommand({
    shell: "/bin/zsh",
    prelude: "echo setup",
    piArgs: ["--extension", "/tmp/ext path/index.js"],
  });

  assert.match(command, /^'\/bin\/zsh' -lc '/);
  assert.match(command, /echo setup/);
  assert.match(command, /__pi_agent_hub_prelude_status=\$\?/);
  assert.match(command, /exit \$__pi_agent_hub_prelude_status/);
  assert.match(command, /exec pi '\\''--extension'\\'' '\\''\/tmp\/ext path\/index\.js'\\'''$/);
  assert.ok(command.indexOf("echo setup") < command.indexOf("__pi_agent_hub_prelude_status=$?"));
  assert.ok(command.indexOf("__pi_agent_hub_prelude_status=$?") < command.indexOf("exec pi"));
});

test("managedPiCommand shell-quotes prelude and Pi args", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-command-"));
  const bin = join(root, "bin");
  const output = join(root, "args.txt");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), "#!/bin/sh\nprintf '%s\\n' \"$MARK\" > \"$OUTPUT\"\nprintf '%s\\n' \"$@\" >> \"$OUTPUT\"\n", "utf8");
  await chmod(join(bin, "pi"), 0o755);

  const command = managedPiCommand({
    shell: "/bin/sh",
    prelude: "export MARK='setup ok'",
    piArgs: ["--resume", "/tmp/it's saved.jsonl"],
  });
  const child = spawn("/bin/sh", ["-lc", command], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, OUTPUT: output },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
  assert.deepEqual((await readFile(output, "utf8")).trimEnd().split("\n"), ["setup ok", "--resume", "/tmp/it's saved.jsonl"]);
});

test("managedPiCommand does not start Pi when prelude exits nonzero", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-command-"));
  const bin = join(root, "bin");
  const output = join(root, "args.txt");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), `#!/bin/sh\necho ran > ${JSON.stringify(output)}\n`, "utf8");
  await chmod(join(bin, "pi"), 0o755);

  const command = managedPiCommand({ shell: "/bin/sh", prelude: "false", piArgs: ["--help"] });
  const child = spawn("/bin/sh", ["-lc", command], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  assert.equal(code, 1, Buffer.concat(stderr).toString("utf8"));
  await assert.rejects(() => readFile(output, "utf8"), /ENOENT/);
});

test("managedPiCommand treats whitespace-only prelude as unset", () => {
  assert.equal(managedPiCommand({ prelude: "   ", piArgs: ["--help"] }), "pi '--help'");
});

function session(overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "source-session",
    title: "source",
    cwd: "/tmp/project",
    group: "default",
    tmuxSession: "pi-agent-hub-source",
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("forkManagedSession does not register a fork when source history is not saved", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await saveRegistry({ version: 1, sessions: [session({ sessionFile: join(dir, "missing.jsonl") })] });

    await assert.rejects(
      () => forkManagedSession("source-session", { title: "source fork", group: "default" }),
      /history is not saved yet/,
    );

    const registry = JSON.parse(await readFile(join(dir, "registry.json"), "utf8"));
    assert.equal(registry.sessions.length, 1);
    assert.equal(registry.sessions[0].id, "source-session");
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
});
