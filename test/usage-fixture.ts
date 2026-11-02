export const USAGE_NOW = Date.UTC(2026, 10, 2, 12);
export function usageFixture() {
  return {
    version: 1, producer: "pi-accounts", updatedAt: USAGE_NOW,
    accounts: [
      { id: "codex-1", provider: "Codex", label: "Codex 1", plan: "pro", fetchedAt: USAGE_NOW - 120000, checkedAt: USAGE_NOW, resetCredits: 2,
        windows: [{ id: "5h", label: "5h", remainingPercent: 72, resetAt: USAGE_NOW + 5400000, durationMs: 18000000 }, { id: "week", label: "wk", remainingPercent: 48, resetAt: USAGE_NOW + 440000000, durationMs: 604800000 }] },
      { id: "codex-2", provider: "Codex", label: "Codex 2", plan: "plus", fetchedAt: USAGE_NOW - 1320000, checkedAt: USAGE_NOW, resetCredits: 0,
        windows: [{ id: "5h", label: "5h", remainingPercent: 85, resetAt: USAGE_NOW + 15000000, durationMs: 18000000 }] },
      { id: "claude-1", provider: "Claude", label: "Claude 1", plan: "max", fetchedAt: USAGE_NOW - 120000, checkedAt: USAGE_NOW, resetCredits: 0,
        windows: [{ id: "5h", label: "5h", remainingPercent: 12, resetAt: USAGE_NOW + 7500000, durationMs: 18000000 }] },
      { id: "claude-2", provider: "Claude", label: "Claude 2", plan: "max", error: "Login expired. It refreshes the next time Claude runs.", checkedAt: USAGE_NOW, resetCredits: 0, windows: [] },
    ],
    history: {
      source: "fixture:pi-sessions", timeZone: "UTC", generatedAt: USAGE_NOW, firstDay: "2026-08-05",
      providers: [{ id: "claude", label: "Claude" }, { id: "codex", label: "Codex" }, { id: "gemini", label: "Gemini" }],
      daily: Array.from({ length: 90 }, (_, index) => {
        const day = new Date(USAGE_NOW - (89 - index) * 86400000).toISOString().slice(0, 10);
        const activity = [1, 3, 2, 1, 4, 1, 2][index % 7]!;
        return ["claude", "codex", "gemini", "other"].map((provider, p) => ({ day, provider, model: p === 3 ? "unknown-model" : `${provider}-model`, messages: 12, input: 1000 * (4 - p) * activity, output: 2000 * activity, cacheRead: 90000 * activity, cacheWrite: 8000 * activity, cost: 0, estimatedCost: p === 3 ? null : (10 - p * 3) * activity, cacheSavings: p === 3 ? null : 20 * activity }));
      }).flat(),
      hourly: Array.from({ length: 24 }, (_, i) => ({ hour: Math.floor(USAGE_NOW / 3600000) * 3600000 - (23 - i) * 3600000, provider: "claude", model: "claude-model", messages: 1, input: 1000, output: 2000, cacheRead: 9000, cacheWrite: 800, cost: 0, estimatedCost: 0.4 })),
      projects: Array.from({ length: 90 }, (_, i) => ({ day: new Date(USAGE_NOW - (89 - i) * 86400000).toISOString().slice(0, 10), project: "/Users/example/Code/pi-agent-hub", sessions: 1, messages: 48, tokens: 410000 * [1, 3, 2, 1, 4, 1, 2][i % 7]!, cost: 0, estimatedCost: 21 * [1, 3, 2, 1, 4, 1, 2][i % 7]! })),
    },
  };
}
