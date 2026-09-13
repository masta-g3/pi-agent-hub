import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJsonOr, writeJsonAtomic } from "./atomic-json.js";
import { sessionsStateDir } from "./paths.js";

export const NAME_COMMAND_TIMEOUT_MS = 5_000;

export interface NameCommand {
  version: 1;
  revision: string;
  piSessionId: string;
  name: string;
  updatedAt: number;
}

export function nameCommandPath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "name-commands", `${sessionId}.json`);
}

export async function publishNameCommand(sessionId: string, piSessionId: string, name: string): Promise<NameCommand> {
  const command: NameCommand = { version: 1, revision: randomUUID(), piSessionId, name, updatedAt: Date.now() };
  await writeJsonAtomic(nameCommandPath(sessionId), command);
  return command;
}

export async function loadNameCommand(sessionId: string): Promise<NameCommand | undefined> {
  const value = await readJsonOr<unknown>(nameCommandPath(sessionId), undefined);
  if (!value || typeof value !== "object") return undefined;
  const command = value as Partial<NameCommand>;
  if (command.version !== 1
    || typeof command.revision !== "string" || !command.revision
    || typeof command.piSessionId !== "string" || !command.piSessionId
    || typeof command.name !== "string" || !command.name.trim() || /[\r\n]/.test(command.name)
    || typeof command.updatedAt !== "number" || !Number.isFinite(command.updatedAt)) return undefined;
  return command as NameCommand;
}
