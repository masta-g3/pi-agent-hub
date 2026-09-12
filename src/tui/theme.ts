import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DefaultResourceLoader, SettingsManager, type Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isErrno } from "../core/atomic-json.js";
import { colorFromAnsi } from "../core/theme-color.js";
import { agentDir, sessionsStateDir } from "../core/paths.js";
import type { ActiveThemeSnapshot } from "../core/types.js";

export type ThemeToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "border" | "statusLineBg" | "selectedBg";

export type SessionsTheme = Record<ThemeToken, string | number>;

export type TerminalAppearance = "light" | "dark";

export interface DashboardThemeOption {
  name: string;
  theme: SessionsTheme;
  sourcePath?: string;
}

export interface DashboardThemeCatalog {
  options: DashboardThemeOption[];
  diagnostics: string[];
}

export interface DashboardThemeSelection {
  setting: string;
  name: string;
  theme: SessionsTheme;
}

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
  selectedBg: "#33405e",
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
  selectedBg: "#c8d0dc",
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

export function parseAutomaticTheme(setting: string | undefined): { lightTheme: string; darkTheme: string } | undefined {
  if (!setting) return undefined;
  const slash = setting.indexOf("/");
  if (slash < 0 || setting.indexOf("/", slash + 1) >= 0) return undefined;
  const lightTheme = setting.slice(0, slash).trim();
  const darkTheme = setting.slice(slash + 1).trim();
  return lightTheme && darkTheme ? { lightTheme, darkTheme } : undefined;
}

export function resolveThemeName(setting: string | undefined, appearance: TerminalAppearance): string | undefined {
  const automatic = parseAutomaticTheme(setting);
  if (automatic) return appearance === "light" ? automatic.lightTheme : automatic.darkTheme;
  if (setting?.includes("/")) return undefined;
  return setting?.trim() || undefined;
}

export async function readDashboardAppearance(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readPreferences: () => Promise<string> = async () => {
    const { stdout } = await promisify(execFile)("/usr/bin/defaults", ["export", "NSGlobalDomain", "-"], { timeout: 1_000 });
    return stdout;
  },
): Promise<TerminalAppearance> {
  if (platform !== "darwin") return detectTerminalAppearance(env);
  const preferences = await readPreferences();
  // macOS omits AppleInterfaceStyle in light mode. Export avoids a missing-key error.
  return /<key>AppleInterfaceStyle<\/key>\s*<string>Dark<\/string>/.test(preferences) ? "dark" : "light";
}

export function detectTerminalAppearance(env: NodeJS.ProcessEnv = process.env): TerminalAppearance {
  const parts = (env.COLORFGBG ?? "").split(";").reverse();
  const background = parts.map((part) => Number.parseInt(part.trim(), 10)).find((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  if (background === undefined) return "dark";
  const [r, g, b] = ansi256Rgb(background);
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b) >= 0.5 ? "light" : "dark";
}

export async function loadGlobalThemeCatalog(env: NodeJS.ProcessEnv = process.env): Promise<DashboardThemeCatalog> {
  const settings = SettingsManager.create(sessionsStateDir(env), agentDir(env), { projectTrusted: false });
  const loadErrors = settings.drainErrors();
  if (loadErrors.length) throw settingsError(loadErrors);
  const loader = new DefaultResourceLoader({
    cwd: sessionsStateDir(env),
    agentDir: agentDir(env),
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getThemes();
  const options: DashboardThemeOption[] = [
    { name: "dark", theme: darkTheme },
    { name: "light", theme: lightTheme },
  ];
  const seen = new Set(options.map((option) => option.name));
  for (const theme of loaded.themes) {
    const name = theme.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push({ name, theme: await sessionsThemeFromRuntime(theme), ...(theme.sourcePath ? { sourcePath: theme.sourcePath } : {}) });
  }
  return {
    options,
    diagnostics: loaded.diagnostics.map((diagnostic) => diagnostic.message),
  };
}

export async function readGlobalPiThemeSetting(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const settings = SettingsManager.create(sessionsStateDir(env), agentDir(env), { projectTrusted: false });
  const errors = settings.drainErrors();
  if (errors.length) throw settingsError(errors);
  return settings.getThemeSetting();
}

export async function saveGlobalPiTheme(
  setting: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { settingsManager?: SettingsManager } = {},
): Promise<void> {
  const trimmed = setting.trim();
  if (!trimmed || (trimmed.includes("/") && !parseAutomaticTheme(trimmed))) throw new Error("invalid Pi theme setting");
  const settings = options.settingsManager ?? SettingsManager.create(sessionsStateDir(env), agentDir(env), { projectTrusted: false });
  const loadErrors = settings.drainErrors();
  if (loadErrors.length) throw settingsError(loadErrors);
  settings.setTheme(trimmed);
  await settings.flush();
  const writeErrors = settings.drainErrors();
  if (writeErrors.length) throw settingsError(writeErrors);
}

export async function effectiveDashboardTheme(
  catalog: DashboardThemeCatalog,
  preference: { syncPi: boolean; theme?: string },
  appearance: TerminalAppearance,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DashboardThemeSelection> {
  const globalSetting = preference.syncPi || !preference.theme ? await readGlobalPiThemeSetting(env) : undefined;
  const setting = (preference.syncPi ? globalSetting : preference.theme ?? globalSetting) ?? "dark";
  const selection = dashboardThemeForSetting(catalog, setting, appearance);
  const option = catalog.options.find((item) => item.name === selection.name);
  if (!option?.sourcePath) return selection;
  const source = await readThemeJson(option.sourcePath);
  if (!source) return selection;
  option.theme = themeFromPiTheme(source);
  return { ...selection, theme: option.theme };
}

export function dashboardThemeForSetting(catalog: DashboardThemeCatalog, setting: string, appearance: TerminalAppearance): DashboardThemeSelection {
  const name = resolveThemeName(setting, appearance) ?? "dark";
  const option = catalog.options.find((item) => item.name === name) ?? catalog.options.find((item) => item.name === "dark");
  return { setting, name: option?.name ?? "dark", theme: option?.theme ?? darkTheme };
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

export async function loadManagedSessionTheme(session: { activeTheme?: ActiveThemeSnapshot; cwd: string }): Promise<SessionsTheme> {
  return (await loadActiveTheme(session.activeTheme, { cwd: session.cwd })) ?? loadSessionsTheme({ cwd: session.cwd });
}

export function styleToken(theme: SessionsTheme, token: ThemeToken, text: string): string {
  const value = theme[token];
  if (value === "" || text === "") return text;
  return `${ansi(value)}${text}${RESET}`;
}

export function styleBgToken(theme: SessionsTheme, token: ThemeToken, text: string): string {
  const value = theme[token];
  if (value === "" || text === "") return text;
  const bg = ansi(value, 48);
  return `${bg}${text.split(RESET).join(`${RESET}${bg}`)}${RESET}`;
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
    selectedBg: resolveToken("selectedBg"),
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
    if (isErrno(error, "ENOENT")) return {};
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
    if (isErrno(error, "ENOENT")) return undefined;
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
    if (isErrno(error, "ENOENT")) return undefined;
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

async function sessionsThemeFromRuntime(theme: PiTheme): Promise<SessionsTheme> {
  if (theme.sourcePath) {
    const file = await readThemeJson(theme.sourcePath);
    if (file) return themeFromPiTheme(file);
  }
  const next = { ...(theme.name === "light" ? lightTheme : darkTheme) };
  const foregroundTokens: Exclude<ThemeToken, "statusLineBg" | "selectedBg">[] = ["accent", "success", "warning", "error", "muted", "dim", "text", "border"];
  for (const token of foregroundTokens) {
    const value = colorFromAnsi(theme.getFgAnsi(token));
    if (value !== undefined) next[token] = value;
  }
  const selectedBg = colorFromAnsi(theme.getBgAnsi("selectedBg"));
  if (selectedBg !== undefined) next.selectedBg = selectedBg;
  return next;
}

function ansi256Rgb(index: number): [number, number, number] {
  const base: [number, number, number][] = [
    [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
    [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ];
  if (index < 16) return base[index] ?? [0, 0, 0];
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return [gray, gray, gray];
  }
  const value = index - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return [levels[Math.floor(value / 36)] ?? 0, levels[Math.floor(value / 6) % 6] ?? 0, levels[value % 6] ?? 0];
}

function settingsError(errors: { scope: string; error: Error }[]): Error {
  return new Error(errors.map(({ scope, error }) => `${scope} settings: ${error.message}`).join("; "));
}

function ansi(value: string | number, layer: 38 | 48 = 38): string {
  if (typeof value === "number") return `\u001b[${layer};5;${value}m`;
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return "";
  const hex = match[1] ?? "";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `\u001b[${layer};2;${r};${g};${b}m`;
}
