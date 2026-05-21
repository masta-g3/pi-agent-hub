import { readFile } from "node:fs/promises";

export async function readPiSessionName(sessionFile: string): Promise<string | undefined> {
  const content = await readFile(sessionFile, "utf8");
  let name: string | undefined;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isSessionInfo(entry)) continue;
    name = entry.name.trim() || undefined;
  }
  return name;
}

function isSessionInfo(value: unknown): value is { type: "session_info"; name: string } {
  return typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "session_info"
    && typeof (value as { name?: unknown }).name === "string";
}
