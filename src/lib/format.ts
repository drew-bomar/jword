const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Calendar date (YYYY-MM-DD) → "Sep 21, 2026" without timezone shifting. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return dateFormatter.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

/** "3h ago", "2d ago"; falls back to a date for older values. */
export function formatRelative(value: string, now: Date = new Date()): string {
  const then = new Date(value).getTime();
  const diff = Math.max(0, now.getTime() - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatDate(value.slice(0, 10));
}
