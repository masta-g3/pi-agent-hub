import type { HeartbeatModel } from "../core/types.js";
import { glyphs, modelIcons, type ModelIcons } from "./glyphs.js";

export type ModelVendor = "anthropic" | "openai" | "google";

/** Long family names get a short form; other families (opus, haiku, fable, ...) show whole. */
const CLAUDE_SHORT: Record<string, string> = { sonnet: "son" };
const TAG_MAX = 8;

/** The id's last path segment without a trailing release date, e.g. `openai/gpt-5-20250807` to `gpt-5`. */
function baseId(id: string): string {
  return id.split("/").at(-1)!.toLowerCase().replace(/-\d{8}$/, "");
}

/** Suffix words become initials: `-codex` to `c`, `-flash-lite` to `fl`. */
function initials(suffix: string): string {
  return suffix.split("-").filter(Boolean).map((word) => word[0]).join("");
}

export function modelTag(model: HeartbeatModel): string {
  const id = baseId(model.id);
  // Current ids put the family first (claude-opus-4-5); Claude 3 ids put the version first (claude-3-5-sonnet).
  const claude = /^claude-(?:([a-z]+)-(\d+)(?:-(\d))?|(\d+)(?:-(\d))?-([a-z]+))(?:-|$)/.exec(id);
  if (claude) {
    const family = claude[1] ?? claude[6]!;
    const major = claude[2] ?? claude[4]!;
    const minor = claude[3] ?? claude[5];
    return `${CLAUDE_SHORT[family] ?? family}${major}${minor ? `.${minor}` : ""}`;
  }
  const versioned = /^(gpt|gemini)-([\d.]+[a-z]?)((?:-[a-z]+)*)$/.exec(id);
  if (versioned) return `${versioned[1] === "gpt" ? "gpt" : "gem"}${versioned[2]}${initials(versioned[3]!)}`;
  return id.slice(0, TAG_MAX);
}

/** The model id names the vendor first; the provider only covers ids that do not, such as custom routes. */
export function modelVendor(model: HeartbeatModel): ModelVendor | undefined {
  const id = model.id.toLowerCase();
  const base = baseId(model.id);
  if (id.includes("claude")) return "anthropic";
  if (/^(gpt|o\d|codex|chatgpt)/.test(base) || id.startsWith("openai/")) return "openai";
  if (id.includes("gemini")) return "google";
  const provider = model.provider.toLowerCase();
  if (/anthropic|claude/.test(provider)) return "anthropic";
  if (/openai|codex/.test(provider)) return "openai";
  if (/google|gemini|vertex/.test(provider)) return "google";
  return undefined;
}

/** Row badge: the short tag, preceded by a vendor icon only when Nerd Font icons are enabled. */
export function modelBadge(model: HeartbeatModel, icons: ModelIcons | undefined = modelIcons): string {
  const tag = modelTag(model);
  return icons ? `${icons[modelVendor(model) ?? "other"]} ${tag}` : tag;
}

/** Card text: badge, thinking level, then provider. */
export function modelCardText(model: HeartbeatModel): string {
  return [modelBadge(model), model.thinking, model.provider].filter(Boolean).join(` ${glyphs.pendingStep} `);
}
