import { readFile } from "node:fs/promises";
import { sessionMetadataPath } from "./paths.js";
import type { SessionMetadata } from "./types.js";

export async function readSessionMetadata(sessionId: string, env: NodeJS.ProcessEnv = process.env): Promise<SessionMetadata | undefined> {
  let text: string;
  try {
    text = await readFile(sessionMetadataPath(sessionId, env), "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }

  try {
    return parseSessionMetadata(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function parseSessionMetadata(value: unknown): SessionMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: SessionMetadata = {
    ...optionalString("source", value.source),
    ...optionalString("goal", value.goal),
    ...optionalString("status", value.status),
    ...optionalString("nextStep", value.nextStep),
    ...optionalString("stage", value.stage),
    ...optionalNumber("confidence", value.confidence),
    ...optionalNumber("updatedAt", value.updatedAt),
  };

  return shouldShowMetadata(metadata) && hasDisplayableMetadata(metadata) ? metadata : undefined;
}

function shouldShowMetadata(metadata: SessionMetadata): boolean {
  return metadata.confidence === undefined || metadata.confidence >= 0.5;
}

function hasDisplayableMetadata(metadata: SessionMetadata): boolean {
  return Boolean(metadata.goal || metadata.status || metadata.nextStep || metadata.stage);
}

function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } as Record<K, string> : {};
}

function optionalNumber<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as Record<K, number> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
