import { beforeEach, expect, it, vi } from "vitest";
import { JwordError } from "@jword/core/browser";
import { requireSession } from "./auth/session";
import { watchlistRead } from "./watchlist-read";

vi.mock("./auth/session", () => ({ requireSession: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it.each(["UNAUTHENTICATED", "FORBIDDEN"] as const)(
  "returns private JSON for %s without invoking the service",
  async (code) => {
    vi.mocked(requireSession).mockRejectedValue(new JwordError(code, "Denied"));
    const service = vi.fn();
    const response = await watchlistRead(service)(
      new Request("http://localhost/api/watchlist/boards?company=Stripe"),
    );
    expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ ok: false, error: { code } });
    expect(service).not.toHaveBeenCalled();
  },
);

it("passes the verified session, raw input, and cancellation to the shared service", async () => {
  const session = {
    actor: { userId: "owner", actorType: "USER" },
    email: "owner@example.com",
    supabase: {},
  } as Awaited<ReturnType<typeof requireSession>>;
  vi.mocked(requireSession).mockResolvedValue(session);
  const service = vi.fn(async () => ({ suggestions: [] }));
  const request = new Request("http://localhost/api/watchlist/boards?company=Stripe&surprise=x");
  const response = await watchlistRead(service)(request);
  expect(service).toHaveBeenCalledWith(
    session,
    { company: "Stripe", surprise: "x" },
    request.signal,
  );
  expect(await response.json()).toEqual({ ok: true, data: { suggestions: [] } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
