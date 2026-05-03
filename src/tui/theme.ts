import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { agentDir } from "../core/paths.js";

export type ThemeToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text" | "border";

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
};

interface PiSettings {
  theme?: string;
}

interface PiThemeFile {
  name?: string;
  vars?: Record<string, string | number>;
  colors?: Record<string, string | number>;
}

export async function loadSessionsTheme(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<SessionsTheme> {
  const env = options.env ?? process.env;
  const name = await readThemeName(options.cwd, env);
  if (!name || name === "dark" || name === "light") return darkTheme;
  const file = await findThemeFile(name, options.cwd, env);
  if (!file) return darkTheme;
  const parsed = JSON.parse(await readFile(file, "utf8")) as PiThemeFile;
  return themeFromPiTheme(parsed);
}

export function styleToken(theme: SessionsTheme, token: ThemeToken, text: string): string {
  const value = theme[token];
  if (value === "" || text === "") return text;
  return `${ansi(value)}${text}${RESET}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function themeFromPiTheme(theme: PiThemeFile): SessionsTheme {
  const vars = theme.vars ?? {};
  const colors = theme.colors ?? {};
  const resolveToken = (token: ThemeToken): string | number => {
    const value = colors[token];
    if (typeof value === "string" && value in vars) return vars[value] ?? darkTheme[token];
    return value ?? darkTheme[token];
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
  };
}

async function readThemeName(cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const paths = [
    cwd ? join(resolve(cwd), ".pi", "settings.json") : undefined,
    join(agentDir(env), "settings.json"),
  ].filter((path): path is string => Boolean(path));
  for (const path of paths) {
    try {
      const settings = JSON.parse(await readFile(path, "utf8")) as PiSettings;
      if (settings.theme) return settings.theme;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return undefined;
}

async function findThemeFile(name: string, cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const paths = [
    cwd ? join(resolve(cwd), ".pi", "themes", `${name}.json`) : undefined,
    join(agentDir(env), "themes", `${name}.json`),
  ].filter((path): path is string => Boolean(path));
  for (const path of paths) {
    try {
      await readFile(path, "utf8");
      return path;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return undefined;
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
