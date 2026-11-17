export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  all: "All Categories",
  power_tools: "Power Tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  automotive: "Automotive",
  other: "Other",
};

export const CONDITION_LABELS: Record<string, string> = {
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};
