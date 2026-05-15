#!/usr/bin/env node
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { configPath, effectiveMcpCatalogPath, effectiveSessionPrelude, effectiveSkillPoolDirs, loadSessionsConfig, setSessionPrelude, unsetSessionPrelude } from "./core/config.js";
import { extensionPath } from "./core/extension-path.js";
import { CLI_COMMAND } from "./core/names.js";
import { registryPath, sessionsStateDir } from "./core/paths.js";
import { loadRegistry } from "./core/registry.js";
import { hasTmux, inspectSwitchReturnBinding } from "./core/tmux.js";
import { dashboardEnv, openDashboard } from "./app/dashboard.js";
import { runTui } from "./app/run-tui.js";
import { deleteManagedSession } from "./app/delete-session.js";
import { addManagedSession, forkManagedSession, restartManagedSession, startManagedSession, stopManagedSession } from "./app/session-commands.js";
import { startMcpPool } from "./mcp/pool-daemon.js";

const command = process.argv[2] ?? "dashboard";
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case "dashboard":
      await dashboard();
      return;
    case "tui":
      await runTui();
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "list":
      await list();
      return;
    case "add":
      await add(args);
      return;
    case "start":
      await start(args[0]);
      return;
    case "stop":
      await stop(args[0]);
      return;
    case "restart":
      await restart(args[0]);
      return;
    case "delete":
      await deleteCommand(args[0]);
      return;
    case "fork":
      await fork(args);
      return;
    case "mcp-pool":
      await mcpPool();
      return;
    case "doctor":
      await doctor();
      return;
    case "config":
      await configCommand(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  console.log(`${CLI_COMMAND}

Usage:
  ${CLI_COMMAND}              open dashboard tmux session
  ${CLI_COMMAND} tui          run TUI directly
  ${CLI_COMMAND} list
  ${CLI_COMMAND} add <cwd> [-t title] [-g group] [--add-cwd path ...]
  ${CLI_COMMAND} start <session-id>
  ${CLI_COMMAND} stop <session-id>
  ${CLI_COMMAND} restart <session-id>
  ${CLI_COMMAND} delete <session-id>
  ${CLI_COMMAND} fork <session-id> [-t title] [-g group]
  ${CLI_COMMAND} mcp-pool
  ${CLI_COMMAND} doctor
  ${CLI_COMMAND} config get
  ${CLI_COMMAND} config set session-prelude <shell snippet>
  ${CLI_COMMAND} config unset session-prelude
`);
}

async function dashboard() {
  if (!(await hasTmux())) throw new Error(`tmux is required for the dashboard session; use \`${CLI_COMMAND} tui\` to run directly`);
  await openDashboard({
    cwd: process.cwd(),
    command: `${CLI_COMMAND} tui`,
    insideTmux: Boolean(process.env.TMUX),
    env: dashboardEnv(),
  });
}

async function list() {
  const registry = await loadRegistry();
  if (!registry.sessions.length) {
    console.log("No managed Pi sessions.");
    return;
  }
  for (const session of registry.sessions) {
    console.log(`${session.id}\t${session.status}\t${session.group}\t${session.title}\t${session.cwd}`);
  }
}

async function add(argv: string[]) {
  const cwdArg = argv[0];
  if (!cwdArg) throw new Error(`Usage: ${CLI_COMMAND} add <cwd> [-t title] [-g group] [--add-cwd path ...]`);
  const title = flag(argv, "-t") ?? flag(argv, "--title");
  const group = flag(argv, "-g") ?? flag(argv, "--group");
  const additionalCwds = flags(argv, "--add-cwd");
  const record = await addManagedSession({ cwd: cwdArg, title, group, additionalCwds });
  console.log(record.id);
}

async function start(id: string | undefined) {
  if (!id) throw new Error(`Usage: ${CLI_COMMAND} start <session-id>`);
  await startManagedSession(id);
}

async function stop(id: string | undefined) {
  if (!id) throw new Error(`Usage: ${CLI_COMMAND} stop <session-id>`);
  await stopManagedSession(id);
}

async function restart(id: string | undefined) {
  if (!id) throw new Error(`Usage: ${CLI_COMMAND} restart <session-id>`);
  await restartManagedSession(id);
}

async function deleteCommand(id: string | undefined) {
  if (!id) throw new Error(`Usage: ${CLI_COMMAND} delete <session-id>`);
  const deleted = await deleteManagedSession(id);
  console.log(`deleted ${deleted.id}\t${deleted.title}`);
}

async function fork(argv: string[]) {
  const sourceId = argv[0];
  if (!sourceId) throw new Error(`Usage: ${CLI_COMMAND} fork <session-id> [-t title] [-g group]`);
  const title = flag(argv, "-t") ?? flag(argv, "--title");
  const group = flag(argv, "-g") ?? flag(argv, "--group");
  const record = await forkManagedSession(sourceId, { title, group });
  console.log(record.id);
}

async function mcpPool() {
  const pool = await startMcpPool({ socketPath: `${sessionsStateDir()}/pool/pool.sock` });
  console.log(`MCP pool listening at ${pool.socketPath}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await pool.close();
}

async function configCommand(argv: string[]) {
  const action = argv[0];
  if (action === "get") {
    console.log(JSON.stringify(await loadSessionsConfig(), null, 2));
    return;
  }
  if (action === "set" && argv[1] === "session-prelude") {
    const prelude = argv.slice(2).join(" ").trim();
    if (!prelude) throw new Error(`Usage: ${CLI_COMMAND} config set session-prelude <shell snippet>`);
    await setSessionPrelude(prelude);
    console.log("updated session-prelude");
    return;
  }
  if (action === "unset" && argv[1] === "session-prelude") {
    await unsetSessionPrelude();
    console.log("unset session-prelude");
    return;
  }
  throw new Error(`Usage: ${CLI_COMMAND} config get|set|unset ...`);
}

async function doctor() {
  const dir = sessionsStateDir();
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
  const ext = extensionPath();
  console.log(`sessions dir: ${dir}`);
  console.log(`registry:   ${registryPath()}`);
  console.log(`config:     ${configPath()}`);
  console.log(`session prelude: ${(await effectiveSessionPrelude()) ? "configured" : "none"}`);
  console.log(`skill dirs: ${(await effectiveSkillPoolDirs()).join(", ")}`);
  console.log(`mcp:        ${await effectiveMcpCatalogPath()}`);
  console.log(`writable:   ok`);
  console.log(`tmux:       ${(await hasTmux()) ? "ok" : "missing"}`);
  const returnKey = await inspectSwitchReturnBinding();
  if (returnKey.active) {
    const state = returnKey.stale ? "stale" : "active";
    console.log(`return key: ${state} ${returnKey.returnKey} ${returnKey.targetSession} -> ${returnKey.controlSession}`);
  }
  console.log(`extension:  ${ext}`);
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function flags(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]!);
  }
  return values;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
