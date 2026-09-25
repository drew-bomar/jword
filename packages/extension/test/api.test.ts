import { describe, expect, it } from "vitest";
import { callJword } from "../src/api";

const URL_ = "http://localhost:3200";

function respond(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}
const offline: typeof fetch = async () => {
  throw new TypeError("Failed to fetch");
};

describe("callJword", () => {
  it("posts JSON with the session cookie to the op's endpoint", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ ok: true, data: [] }));
    };
    const result = await callJword(URL_, "findDuplicates", { company: "Acme" }, fetchImpl);
    expect(result).toEqual({ ok: true, data: [] });
    expect(seen!.url).toBe(`${URL_}/api/extension/find-duplicates`);
    expect(seen!.init).toMatchObject({ method: "POST", credentials: "include", redirect: "error" });
    expect(seen!.init!.body).toBe(JSON.stringify({ company: "Acme" }));
  });

  it("passes jword's typed errors through unchanged", async () => {
    const body = {
      ok: false,
      error: { code: "CONFLICT", message: "Changed", reason: "STALE_VERSION" },
    };
    expect(await callJword(URL_, "updatePosting", {}, respond(409, body))).toEqual(body);
    const signedOut = { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in" } };
    expect(await callJword(URL_, "getApplication", {}, respond(401, signedOut))).toEqual(signedOut);
  });

  it("marks a lost save as unconfirmed so the identical command is retried", async () => {
    for (const fetchImpl of [offline, respond(502, "<html>Bad gateway</html>")]) {
      for (const operation of ["createApplication", "addWatch"] as const) {
        const result = await callJword(URL_, operation, {}, fetchImpl);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("OUTCOME_UNKNOWN");
      }
    }
  });

  it("reports an unreachable jword for reads without claiming anything was saved", async () => {
    const result = await callJword(URL_, "searchApplications", { text: "a" }, offline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toContain(URL_);
    }
  });
});
