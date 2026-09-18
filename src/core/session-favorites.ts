import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadStore, updateStore, type JsonStore } from "./atomic-json.js";
import { normalizeAdditionalCwds } from "./multi-repo.js";
import { sessionFavoritesPath } from "./paths.js";
import { normalizeGroup } from "./registry.js";

export interface SessionFavorite {
  id: string;
  name: string;
  cwds: string[];
}

export interface SessionFavorites {
  version: 1;
  favorites: SessionFavorite[];
}

function favoritesStore(path: string): JsonStore<SessionFavorites> {
  return { path, empty: emptySessionFavorites, parse: parseSessionFavorites };
}

export async function loadSessionFavorites(path = sessionFavoritesPath()): Promise<SessionFavorites> {
  return loadStore(favoritesStore(path));
}

export async function saveSessionFavorite(
  name: string,
  cwds: string[],
  path = sessionFavoritesPath(),
): Promise<SessionFavorites> {
  const normalizedName = normalizeFavoriteName(name);
  const normalizedCwds = normalizeFavoriteCwds(cwds);
  return updateStore(favoritesStore(path), (store) => {
    assertUniqueName(store, normalizedName);
    return {
      version: 1,
      favorites: [...store.favorites, { id: randomUUID(), name: normalizedName, cwds: normalizedCwds }],
    };
  });
}

export async function updateSessionFavorite(
  id: string,
  cwds: string[],
  path = sessionFavoritesPath(),
): Promise<SessionFavorites> {
  const normalizedCwds = normalizeFavoriteCwds(cwds);
  return updateStore(favoritesStore(path), (store) => {
    const index = favoriteIndex(store, id);
    const favorites = store.favorites.slice();
    favorites[index] = { ...favorites[index]!, cwds: normalizedCwds };
    return { version: 1, favorites };
  });
}

export async function renameSessionFavorite(
  id: string,
  name: string,
  path = sessionFavoritesPath(),
): Promise<SessionFavorites> {
  const normalizedName = normalizeFavoriteName(name);
  return updateStore(favoritesStore(path), (store) => {
    const index = favoriteIndex(store, id);
    assertUniqueName(store, normalizedName, id);
    const favorites = store.favorites.slice();
    favorites[index] = { ...favorites[index]!, name: normalizedName };
    return { version: 1, favorites };
  });
}

export async function removeSessionFavorite(
  id: string,
  path = sessionFavoritesPath(),
): Promise<SessionFavorites> {
  return updateStore(favoritesStore(path), (store) => {
    const index = favoriteIndex(store, id);
    return {
      version: 1,
      favorites: store.favorites.filter((_, candidate) => candidate !== index),
    };
  });
}

function emptySessionFavorites(): SessionFavorites {
  return { version: 1, favorites: [] };
}

function parseSessionFavorites(value: SessionFavorites): SessionFavorites {
  if (!value || value.version !== 1 || !Array.isArray(value.favorites)) {
    throw new Error("Invalid session favorites store");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const favorite of value.favorites) {
    if (!favorite || typeof favorite.id !== "string" || !favorite.id || typeof favorite.name !== "string" || !Array.isArray(favorite.cwds)) {
      throw new Error("Invalid session favorite");
    }
    let name: string;
    let cwds: string[];
    try {
      name = normalizeFavoriteName(favorite.name);
      cwds = normalizeFavoriteCwds(favorite.cwds);
    } catch {
      throw new Error("Invalid session favorite");
    }
    if (name !== favorite.name || cwds.length !== favorite.cwds.length || cwds.some((cwd, index) => cwd !== favorite.cwds[index])) {
      throw new Error("Invalid session favorite");
    }
    if (ids.has(favorite.id) || names.has(name)) throw new Error("Invalid session favorite");
    ids.add(favorite.id);
    names.add(name);
  }
  return value;
}

function normalizeFavoriteName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Favorite name is required");
  if (/\p{Cc}/u.test(trimmed)) throw new Error("Favorite name cannot contain control characters");
  return normalizeGroup(trimmed);
}

function normalizeFavoriteCwds(cwds: string[]): string[] {
  const primaryInput = cwds[0]?.trim();
  if (!primaryInput) throw new Error("A primary directory is required");
  const primary = resolve(primaryInput);
  return [primary, ...normalizeAdditionalCwds(primary, cwds.slice(1))];
}

function favoriteIndex(store: SessionFavorites, id: string): number {
  const index = store.favorites.findIndex((favorite) => favorite.id === id);
  if (index === -1) throw new Error(`Session favorite not found: ${id}`);
  return index;
}

function assertUniqueName(store: SessionFavorites, name: string, exceptId?: string): void {
  if (store.favorites.some((favorite) => favorite.name === name && favorite.id !== exceptId)) {
    throw new Error(`A session favorite named "${name}" already exists`);
  }
}
