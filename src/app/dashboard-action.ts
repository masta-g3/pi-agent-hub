import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "../core/atomic-json.js";
import { sessionsStateDir } from "../core/paths.js";

export type DashboardAction =
  | { action: "rename"; tmuxSession: string }
  | { action: "return"; key: "alt-q" };

export function dashboardActionPath(stateDir = sessionsStateDir()): string {
  return join(stateDir, "return-key", "dashboard-action.json");
}

export async function consumeDashboardAction(path = dashboardActionPath()): Promise<DashboardAction | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
  await rm(path, { force: true });

  const action = JSON.parse(raw) as Partial<DashboardAction>;
  if (action.action === "rename" && typeof action.tmuxSession === "string" && action.tmuxSession) return action as DashboardAction;
  if (action.action === "return" && action.key === "alt-q") return { action: "return", key: "alt-q" };
  return undefined;
}
