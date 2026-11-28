import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxExec } from "./tmux.js";

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 2_000;
/** DNS labels of letters, digits and inner hyphens, ending in `.ts.net`. */
const TAILNET_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/iu;

/** Runs the read-only status command with a timeout, so a hung CLI cannot hold the dashboard. */
const tailscaleExec: TmuxExec = {
  async exec(command, args) {
    const result = await execFileAsync(command, args, { encoding: "utf8", timeout: STATUS_TIMEOUT_MS });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

/** `tailscale serve status --json`, parsed; undefined when tailscale is missing, fails, or prints no JSON. */
export async function readServeStatus(exec: TmuxExec = tailscaleExec): Promise<unknown> {
  let stdout: string;
  try {
    // Hub only reads Serve; it never runs a command that changes it.
    ({ stdout } = await exec.exec("tailscale", ["serve", "status", "--json"]));
  } catch {
    // No tailscale, not logged in, or a timeout: the inbox is simply not published.
    return undefined;
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The https address Tailscale Serve publishes for this loopback port. Only an HTTPS root mount counts: the page
 * loads root-relative files such as `/app.js` and `/api/events`, so a sub-path mount would not work.
 */
export function servedAddress(status: unknown, port: number): string | undefined {
  const tcp = record(record(status)?.TCP);
  const web = record(record(status)?.Web);
  if (!tcp || !web) return undefined;
  const targets = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  for (const key of Object.keys(web).sort()) {
    const match = /^(.+):(\d+)$/u.exec(key);
    if (!match) continue;
    const [, host, servePort] = match;
    // Only a tailnet DNS name and a real port make an address a phone can open; anything else is not Serve's.
    if (!TAILNET_HOST.test(host!) || Number(servePort) < 1 || Number(servePort) > 65_535) continue;
    if (record(tcp[servePort!])?.HTTPS !== true) continue;
    const proxy = record(record(record(web[key])?.Handlers)?.["/"])?.Proxy;
    if (typeof proxy !== "string" || !targets.has(proxy.replace(/\/$/u, ""))) continue;
    return servePort === "443" ? `https://${host}` : `https://${host}:${servePort}`;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
