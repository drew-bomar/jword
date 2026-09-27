import { describe, expect, it, vi } from "vitest";
import { createProviderHttp, HttpStatusError, ResponseTooLargeError } from "../src/discovery/http";

describe("provider HTTP boundary", () => {
  it("refuses redirects without requesting the target", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    );
    const http = createProviderHttp({ fetch: fetcher });
    await expect(
      http.json("https://api.lever.co/v0/postings/acme", new AbortController().signal, {}, 100),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("cancels an oversized stream instead of parsing its truncated JSON", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jobs":[]} extra bytes'));
      },
      cancel,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(
      createProviderHttp({ fetch: fetcher }).json(
        "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
        new AbortController().signal,
        {},
        10,
      ),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
