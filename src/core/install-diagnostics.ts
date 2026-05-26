import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, CLI_COMMAND } from "./names.js";
import { agentDir } from "./paths.js";

export type CliInstallState = "ok" | "pi-package-missing" | "path-not-pi-bin" | "version-mismatch";

export interface CliInstallStatus {
  status: CliInstallState;
  piPackageRoot: string;
  piBinCandidates: string[];
  pathCommand?: string;
  runningPackageRoot?: string;
  piVersion?: string;
  runningVersion?: string;
  fix: string[];
}

export interface InspectCliInstallOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  currentFile?: string;
}

export function piPackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentDir(env), "npm", "node_modules", APP_NAME);
}

export function piBinCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const binDir = join(agentDir(env), "npm", "node_modules", ".bin");
  if (platform === "win32") return [join(binDir, `${CLI_COMMAND}.cmd`), join(binDir, `${CLI_COMMAND}.ps1`), join(binDir, CLI_COMMAND)];
  return [join(binDir, CLI_COMMAND)];
}

export async function inspectCliInstall(options: InspectCliInstallOptions = {}): Promise<CliInstallStatus> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const piRoot = piPackageRoot(env);
  const piBins = piBinCandidates(env, platform);
  const fix = installFixLines(env, platform, piBins[0] ?? join(agentDir(env), "npm", "node_modules", ".bin", CLI_COMMAND));
  const base: CliInstallStatus = { status: "pi-package-missing", piPackageRoot: piRoot, piBinCandidates: piBins, fix };

  const piVersion = await packageVersion(piRoot);
  const pathCommand = await resolvePathCommand(CLI_COMMAND, env, platform);
  const currentFile = options.currentFile ?? fileURLToPath(import.meta.url);
  const runningPackageRoot = await findPackageRoot(currentFile);
  const runningVersion = runningPackageRoot ? await packageVersion(runningPackageRoot) : undefined;
  const statusBase = { ...base, pathCommand, runningPackageRoot, piVersion, runningVersion };

  if (!piVersion) return statusBase;
  if (runningPackageRoot && await samePath(runningPackageRoot, piRoot)) return { ...statusBase, status: "ok" };
  if (runningVersion && piVersion !== runningVersion) return { ...statusBase, status: "version-mismatch" };
  if (pathCommand && await isPiBin(pathCommand, piBins, piRoot)) return { ...statusBase, status: "ok" };
  return { ...statusBase, status: "path-not-pi-bin" };
}

export function formatCliInstallWarning(status: CliInstallStatus): string | undefined {
  if (status.status !== "version-mismatch") return undefined;
  const running = status.runningPackageRoot ?? status.pathCommand ?? "unknown";
  return [
    `${APP_NAME} warning: ${CLI_COMMAND} on PATH is not the Pi-installed package.`,
    `Running: ${running}${status.runningVersion ? ` (${status.runningVersion})` : ""}`,
    `Pi package: ${status.piPackageRoot}${status.piVersion ? ` (${status.piVersion})` : ""}`,
    `Fix: ${status.fix[0] ?? `put ${status.piBinCandidates[0] ?? "Pi's npm .bin"} before the global npm bin on PATH`}`,
  ].join("\n");
}

export function formatCliInstallDoctor(status: CliInstallStatus): string[] {
  const lines = [
    `cli package: ${status.status} ${status.runningPackageRoot ?? "unknown"}${status.runningVersion ? ` ${status.runningVersion}` : ""}`,
    `pi package:  ${status.piPackageRoot}${status.piVersion ? ` ${status.piVersion}` : " missing"}`,
    `pi bin:      ${status.piBinCandidates[0] ?? "unknown"}`,
    `path ${CLI_COMMAND}: ${status.pathCommand ?? "not found"}`,
  ];
  if (status.status === "version-mismatch" || status.status === "path-not-pi-bin") {
    lines.push("cli warning: PATH may resolve a stale global dashboard CLI before Pi's package bin.");
    lines.push(...status.fix.map((line) => `fix: ${line}`));
  }
  return lines;
}

export function shouldWarnForCommand(command: string): boolean {
  return command === "dashboard" || command === "tui";
}

async function packageVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (parsed.name !== APP_NAME || typeof parsed.version !== "string") return undefined;
    return parsed.version;
  } catch {
    return undefined;
  }
}

async function findPackageRoot(startFile: string): Promise<string | undefined> {
  let dir = dirname(resolve(startFile));
  for (;;) {
    if (await packageVersion(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function resolvePathCommand(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | undefined> {
  const pathValue = pathEnv(env);
  if (!pathValue) return undefined;
  const delimiter = platform === "win32" ? ";" : ":";
  const extensions = platform === "win32" ? windowsExtensions(env) : [""];
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${command}${ext}`);
      if (await canRun(candidate, platform)) return candidate;
    }
  }
  return undefined;
}

function pathEnv(env: NodeJS.ProcessEnv): string | undefined {
  const pathEntry = Object.entries(env).find(([key]) => key.toLowerCase() === "path");
  return pathEntry?.[1];
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const pathext = Object.entries(env).find(([key]) => key.toLowerCase() === "pathext")?.[1] ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  const values = pathext.split(";").filter(Boolean).map((ext) => ext.toLowerCase());
  return [...values, ""];
}

async function canRun(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isPiBin(command: string, piBins: string[], piRoot: string): Promise<boolean> {
  const realCommand = await realPathOrResolve(command);
  for (const candidate of piBins) {
    if (realCommand === await realPathOrResolve(candidate)) return true;
  }
  const realPiRoot = await realPathOrResolve(piRoot);
  const relativeCommand = relative(realPiRoot, realCommand);
  return relativeCommand !== "" && !relativeCommand.startsWith("..") && !isAbsolute(relativeCommand);
}

async function samePath(left: string, right: string): Promise<boolean> {
  return await realPathOrResolve(left) === await realPathOrResolve(right);
}

async function realPathOrResolve(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return resolve(value);
  }
}

function installFixLines(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, piBin: string): string[] {
  if (platform === "win32") {
    const binDir = join(agentDir(env), "npm", "node_modules", ".bin");
    return [
      `add ${binDir} before the global npm bin in your user PATH, then reopen the terminal`,
      `or run ${join(binDir, `${CLI_COMMAND}.cmd`)} doctor directly`,
    ];
  }
  return [
    `put ${dirname(piBin)} before the global npm bin on PATH`,
    `or run ${piBin} doctor directly`,
    `optional shim: mkdir -p ~/.local/bin && ln -sf ${piBin} ~/.local/bin/${CLI_COMMAND}`,
  ];
}
