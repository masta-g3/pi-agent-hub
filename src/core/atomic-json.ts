import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonStore<T> {
  path: string;
  empty: () => T;
  parse?: (value: T) => T;
  snapshot?: (value: T) => string;
}

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const text = await readFile(path, { encoding: "utf8", signal });
  return JSON.parse(text) as T;
}

export async function readJsonOr<T>(path: string, fallback: T, signal?: AbortSignal): Promise<T> {
  try {
    return await readJson<T>(path, signal);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function loadStore<T>(store: JsonStore<T>): Promise<T> {
  const value = await readJsonOr<T>(store.path, store.empty());
  return store.parse ? store.parse(value) : value;
}

export async function withFileLock<T>(path: string, fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lockDir = `${path}.lock`;
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for file lock: ${lockDir}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

export async function updateStore<T>(
  store: JsonStore<T>,
  mutate: (value: T) => T | void | Promise<T | void>,
): Promise<T> {
  return withFileLock(store.path, async () => {
    const value = await loadStore(store);
    const before = store.snapshot?.(value);
    const next = (await mutate(value)) ?? value;
    if (before !== undefined && before === store.snapshot?.(next)) return next;
    await writeJsonAtomic(store.path, next);
    return next;
  });
}
