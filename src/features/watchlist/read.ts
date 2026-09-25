import type { ActionResult } from "@/server/actions/result";

/** Transport failures are retryable read errors, never an indefinitely spinning control. */
export async function readWatchlist<T>(
  endpoint: "boards" | "companies" | "suggestions",
  input: Record<string, string | string[]> = {},
  signal?: AbortSignal,
): Promise<ActionResult<T>> {
  try {
    const query = new URLSearchParams(
      Object.entries(input).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map((item) => [key, item]),
      ),
    );
    const response = await fetch(`/api/watchlist/${endpoint}?${query}`, {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    const result = (await response.json()) as ActionResult<T>;
    if (
      !result ||
      typeof result.ok !== "boolean" ||
      (result.ok && !("data" in result)) ||
      (!result.ok && !result.error?.message)
    ) {
      throw new Error("Unexpected read response");
    }
    if (!response.ok && result.ok) throw new Error("Unexpected read status");
    return result;
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not load this lookup. Check your connection and try again.",
      },
    };
  }
}
