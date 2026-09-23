export const DEFAULT_JWORD_URL = "http://localhost:3200";

/** The jword origin (scheme + host + port) the overlay talks to, e.g. http://localhost:3200. */
export async function getJwordOrigin(): Promise<string> {
  const stored = await chrome.storage.sync.get("jwordUrl");
  return (
    normalizeOrigin(typeof stored.jwordUrl === "string" ? stored.jwordUrl : "") ?? DEFAULT_JWORD_URL
  );
}

/** Accept only http(s) origins; paths and queries are dropped. */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Match pattern for host permissions. Chrome match patterns ignore the port. */
export function originPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/** Session-storage key for the capture shown in a tab's overlay. */
export function captureKey(tabId: number): string {
  return `capture:tab:${tabId}`;
}
