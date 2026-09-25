import { afterEach, expect, it, vi } from "vitest";
import { readWatchlist } from "./read";

afterEach(() => vi.unstubAllGlobals());
it("returns a recoverable error after transport or response failures", async () => {
  for (const fetch of [
    async () => {
      throw new Error("offline");
    },
    async () => new Response("<html>Sign in</html>"),
    async () => Response.json({ unexpected: true }),
  ]) {
    vi.stubGlobal("fetch", fetch);
    expect(await readWatchlist("boards", { company: "Stripe" })).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
  }
});
it("passes cancellation and disables caching of owner data", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, data: [] }));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(await readWatchlist("companies", { text: "A & B" }, signal)).toEqual({
    ok: true,
    data: [],
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/watchlist/companies?text=A+%26+B",
    expect.objectContaining({ signal, cache: "no-store", credentials: "same-origin" }),
  );
});
it("repeats a key for each value in a list", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, data: {} }));
  vi.stubGlobal("fetch", fetch);
  await readWatchlist("boards", { company: "X", boardUrls: ["https://a/1", "https://b/2"] });
  expect(fetch).toHaveBeenCalledWith(
    "/api/watchlist/boards?company=X&boardUrls=https%3A%2F%2Fa%2F1&boardUrls=https%3A%2F%2Fb%2F2",
    expect.anything(),
  );
});
