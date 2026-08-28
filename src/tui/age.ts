export function ageLabel(ageMs: number, belowMinute: "seconds" | "now" = "seconds"): string {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ageMs < minute) return belowMinute === "now" ? "now" : `${Math.floor(ageMs / 1_000)}s`;
  if (ageMs < hour) return `${Math.floor(ageMs / minute)}m`;
  if (ageMs < day) return `${Math.floor(ageMs / hour)}h`;
  return `${Math.floor(ageMs / day)}d`;
}
