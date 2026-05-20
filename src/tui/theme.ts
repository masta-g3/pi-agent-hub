import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDir } from "../core/paths.js";
import type { ActiveThemeSnapshot } from "../core/types.js";

export type ThemeToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "border" | "statusLineBg";

export type SessionsTheme = Record<ThemeToken, string | number>;

const RESET = "\u001b[0m";

export const darkTheme: SessionsTheme = {
  accent: "#7aa2f7",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  muted: 244,
  dim: 240,
  text: "",
  border: 240,
  statusLineBg: "#1a1b26",
};

export const lightTheme: SessionsTheme = {
  accent: "#5a8080",
  success: "#588458",
  warning: "#9a7326",
  error: "#aa5555",
  muted: "#6c6c6c",
  dim: "#767676",
  text: "",
  border: "#547da7",
  statusLineBg: "#dce0e8",
};

interface PiSettings {
  theme?: string;
  themes?: string[];
  packages?: PackageSetting[];
}

type PackageSetting = string | { source?: string; themes?: string[] };

interface PiThemeFile {
  name?: string;
  vars?: Record<string, string | number>;
  colors?: Record<string, string | number>;
}

interface ThemeScope {
  baseDir: string;
  conventionalThemeDir: string;
  settings: PiSettings;
}

type ThemeCandidate = { type: "dir"; path: string } | { type: "file"; path: string };

interface GitParts {
  host: string;
  path: string;
}

export async function loadSessionsTheme(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<SessionsTheme> {
  const env = options.env ?? process.env;
  const scopes = await loadThemeScopes(options.cwd, env);
  const name = scopes.find((scope) => scope.settings.theme)?.settings.theme;
  return (await loadNamedTheme(name, scopes)) ?? darkTheme;
}

export async function loadActiveTheme(activeTheme: ActiveThemeSnapshot | undefined, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<SessionsTheme | undefined> {
  if (!activeTheme) return undefined;

  let resolved: SessionsTheme | undefined;
  if (activeTheme.sourcePath) {
    const theme = await readThemeJson(activeTheme.sourcePath);
    if (theme) resolved = themeFromPiTheme(theme);
  }

  const name = activeTheme.name;
  if (!resolved && name && name !== "<in-memory>") {
    const scopes = await loadThemeScopes(options.cwd, options.env ?? process.env);
    resolved = await loadNamedTheme(name, scopes);
  }

  if (activeTheme.tokens && Object.keys(activeTheme.tokens).length) return { ...(resolved ?? darkTheme), ...activeTheme.tokens };
  return resolved;
}

export function styleToken(theme: SessionsTheme, token: ThemeToken, text: string): string {
  const value = theme[token];
  if (value === "" || text === "") return text;
  return `${ansi(value)}${text}${RESET}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function stripAnsiExceptItalics(text: string): string {
  return text.replace(/\u001b\[([0-9;:]*)m/g, (_match, params: string) => {
    const kept = italicSgrParams(params);
    return kept.length ? `\u001b[${kept.join(";")}m` : "";
  });
}

function italicSgrParams(params: string): string[] {
  const parts = params === "" ? ["0"] : params.split(";");
  const kept: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    if (part.includes(":")) continue;
    const code = part === "" ? 0 : Number(part);
    if (!Number.isInteger(code)) continue;
    if (code === 38 || code === 48 || code === 58) {
      const mode = Number(parts[index + 1]);
      index += mode === 2 ? 4 : mode === 5 ? 2 : 1;
      continue;
    }
    if (code === 0 || code === 3 || code === 23) kept.push(String(code));
  }
  return kept;
}

export function themeFromPiTheme(theme: PiThemeFile): SessionsTheme {
  const vars = theme.vars ?? {};
  const colors = theme.colors ?? {};
  const resolveToken = (token: ThemeToken): string | number => {
    const value = colors[token];
    if (typeof value === "string" && value in vars) return vars[value] ?? darkTheme[token];
    return value ?? darkTheme[token];
  };
  const resolveOptionalToken = (token: ThemeToken): string | number => {
    const value = colors[token];
    if (typeof value === "string" && value in vars) return vars[value] ?? "";
    return value ?? "";
  };
  return {
    accent: resolveToken("accent"),
    success: resolveToken("success"),
    warning: resolveToken("warning"),
    error: resolveToken("error"),
    muted: resolveToken("muted"),
    dim: resolveToken("dim"),
    text: resolveToken("text"),
    border: resolveToken("border"),
    statusLineBg: resolveOptionalToken("statusLineBg"),
  };
}

async function loadNamedTheme(name: string | undefined, scopes: ThemeScope[]): Promise<SessionsTheme | undefined> {
  if (name === "light") return lightTheme;
  if (!name || name === "dark") return name === "dark" ? darkTheme : undefined;

  for (const candidate of await themeCandidates(scopes)) {
    const theme = await readCandidateTheme(candidate, name);
    if (theme) return themeFromPiTheme(theme);
  }
  return undefined;
}

async function loadThemeScopes(cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<ThemeScope[]> {
  const scopes: ThemeScope[] = [];
  if (cwd) {
    const baseDir = join(resolve(cwd), ".pi");
    const settingsPath = join(baseDir, "settings.json");
    scopes.push({
      baseDir,
      conventionalThemeDir: join(baseDir, "themes"),
      settings: await readSettings(settingsPath),
    });
  }

  const baseDir = agentDir(env);
  const settingsPath = join(baseDir, "settings.json");
  scopes.push({
    baseDir,
    conventionalThemeDir: join(baseDir, "themes"),
    settings: await readSettings(settingsPath),
  });
  return scopes;
}

async function readSettings(path: string): Promise<PiSettings> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PiSettings;
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

async function themeCandidates(scopes: ThemeScope[]): Promise<ThemeCandidate[]> {
  const candidates: ThemeCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: ThemeCandidate) => {
    const key = `${candidate.type}:${candidate.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  for (const scope of scopes) {
    for (const path of scope.settings.themes ?? []) {
      if (!isPlainPath(path)) continue;
      add(candidateFromPath(resolveSettingsPath(path, scope.baseDir)));
    }
    add({ type: "dir", path: scope.conventionalThemeDir });
  }

  const seenPackages = new Set<string>();
  for (const scope of scopes) {
    for (const pkg of scope.settings.packages ?? []) {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      if (!source) continue;
      const packageRoot = packageRootFromSpec(source, scope.baseDir);
      if (!packageRoot || seenPackages.has(packageRoot)) continue;
      seenPackages.add(packageRoot);
      for (const candidate of await packageThemeCandidates(packageRoot, typeof pkg === "string" ? undefined : pkg.themes)) {
        add(candidate);
      }
    }
  }

  return candidates;
}

function resolveSettingsPath(input: string, baseDir: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(baseDir, trimmed);
}

function candidateFromPath(path: string): ThemeCandidate {
  return path.toLowerCase().endsWith(".json") ? { type: "file", path } : { type: "dir", path };
}

async function packageThemeCandidates(packageRoot: string, packageFilter: string[] | undefined): Promise<ThemeCandidate[]> {
  if (packageFilter?.length === 0) return [];
  const entries = packageFilter ?? await packageManifestThemeEntries(packageRoot) ?? ["themes"];
  return entries
    .filter((entry) => isPlainPath(entry) && !hasGlob(entry))
    .map((entry) => candidateFromPath(resolveSettingsPath(entry, packageRoot)));
}

async function packageManifestThemeEntries(packageRoot: string): Promise<string[] | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { pi?: { themes?: unknown } };
    return Array.isArray(manifest.pi?.themes) && manifest.pi.themes.every((entry) => typeof entry === "string")
      ? manifest.pi.themes
      : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function packageRootFromSpec(source: string, baseDir: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed || trimmed.startsWith("npm:")) return undefined;

  const git = gitParts(trimmed);
  if (git) return join(baseDir, "git", git.host, ...git.path.split("/"));

  if (trimmed.startsWith("file://")) return fileURLToPath(trimmed);
  if (trimmed.startsWith("file:")) return resolveSettingsPath(trimmed.slice("file:".length), baseDir);
  if (trimmed.startsWith("github:") || trimmed.startsWith("http:") || trimmed.startsWith("https:") || trimmed.startsWith("ssh:")) return undefined;
  return resolveSettingsPath(trimmed, baseDir);
}

function gitParts(source: string): GitParts | undefined {
  const input = source.startsWith("git:") && !source.startsWith("git://") ? source.slice("git:".length).trim() : source;
  const scpLike = /^git@([^:]+):(.+)$/.exec(input);
  if (scpLike) return normalizedGitParts(scpLike[1] ?? "", scpLike[2] ?? "");

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      return normalizedGitParts(parsed.hostname, parsed.pathname);
    } catch {
      return undefined;
    }
  }

  const shorthand = /^([^/]+)\/(.+)$/.exec(input);
  const host = shorthand?.[1] ?? "";
  if (shorthand && !host.startsWith(".") && (host.includes(".") || host === "localhost")) return normalizedGitParts(host, shorthand[2] ?? "");
  return undefined;
}

function normalizedGitParts(host: string, repoPath: string): GitParts | undefined {
  const cleanPath = repoPath
    .replace(/^\/+/, "")
    .replace(/[#?].*$/, "")
    .replace(/@[^/]*$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (!host || cleanPath.split("/").length < 2) return undefined;
  return { host, path: cleanPath };
}

async function readCandidateTheme(candidate: ThemeCandidate, name: string): Promise<PiThemeFile | undefined> {
  if (candidate.type === "dir") return readThemeJson(join(candidate.path, `${name}.json`));

  const theme = await readThemeJson(candidate.path);
  if (!theme) return undefined;
  if (basename(candidate.path) === `${name}.json` || theme.name === name) return theme;
  return undefined;
}

async function readThemeJson(path: string): Promise<PiThemeFile | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PiThemeFile;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function isPlainPath(input: string): boolean {
  const trimmed = input.trim();
  return Boolean(trimmed) && !["!", "+", "-"].includes(trimmed[0] ?? "");
}

function hasGlob(input: string): boolean {
  return /[*?[\]{}]/.test(input);
}

function ansi(value: string | number): string {
  if (typeof value === "number") return `\u001b[38;5;${value}m`;
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return "";
  const hex = match[1] ?? "";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `\u001b[38;2;${r};${g};${b}m`;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
