import { describe, expect, it } from "vitest";
import { createPublicJobCollector, htmlToText } from "../src/collection/collector";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(route: Route) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const aborted = new Promise<never>((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
    );
    return Promise.race([route(url, init), aborted]);
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("htmlToText", () => {
  it("turns provider HTML into readable plain text", () => {
    expect(
      htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two &amp; three</li></ul>"),
    ).toBe("Hello world\nOne\nTwo & three");
  });
});

describe("Greenhouse collection", () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true";

  it("reads every job with its description and stated first-published date", async () => {
    const { fn, calls } = fakeFetch(() =>
      json({
        jobs: [
          {
            id: 7194969,
            title: " Backend  Engineer ",
            location: { name: "Paris, France" },
            content: "&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;",
            first_published: "2025-08-27T10:34:20-04:00",
            absolute_url: "javascript:alert(1)",
          },
          { id: "42", title: "Designer", location: null, content: null },
        ],
      }),
    );
    const result = await createPublicJobCollector({ fetch: fn }).collect("GREENHOUSE", "stripe");
    expect(calls.map((c) => c.url)).toEqual([url]);
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(result).toEqual({
      status: "complete",
      reason: null,
      reportedTotal: null,
      postings: [
        {
          postingId: "7194969",
          title: "Backend Engineer",
          location: "Paris, France",
          // Built from the board and id; the provider's absolute_url is never stored.
          jobUrl: "https://job-boards.greenhouse.io/stripe/jobs/7194969",
          description: "Build & ship",
          postedOn: "2025-08-27",
        },
        {
          postingId: "42",
          title: "Designer",
          location: null,
          jobUrl: "https://job-boards.greenhouse.io/stripe/jobs/42",
          description: null,
          postedOn: null,
        },
      ],
    });
  });

  it("maps a missing board, provider errors, and bad JSON to failed", async () => {
    const collect = (route: Route) =>
      createPublicJobCollector({ fetch: fakeFetch(route).fn }).collect("GREENHOUSE", "stripe");
    expect(await collect(() => json({}, 404))).toMatchObject({
      status: "failed",
      reason: "BOARD_NOT_FOUND",
    });
    expect(await collect(() => json({}, 503))).toMatchObject({
      status: "failed",
      reason: "PROVIDER_ERROR",
    });
    expect(await collect(() => new Response("<html>"))).toMatchObject({
      status: "failed",
      reason: "INVALID_RESPONSE",
    });
    expect(await collect(() => json({ notJobs: [] }))).toMatchObject({
      status: "failed",
      reason: "INVALID_RESPONSE",
    });
  });

  it("skips a malformed posting and reports the scan as partial", async () => {
    const { fn } = fakeFetch(() => json({ jobs: [{ id: 1, title: "Ok" }, { id: 2 }] }));
    const result = await createPublicJobCollector({ fetch: fn }).collect("GREENHOUSE", "stripe");
    expect(result).toMatchObject({ status: "partial", reason: "INVALID_POSTINGS" });
    expect(result.postings.map((p) => p.postingId)).toEqual(["1"]);
  });
});

describe("Lever collection", () => {
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `id-${from + i}`,
      text: `Role ${from + i}`,
      categories: { location: "Remote" },
      descriptionPlain: "Plain",
      createdAt: Date.parse("2026-09-20T12:00:00Z"),
    }));

  it("pages with skip/limit until a short page", async () => {
    const { fn, calls } = fakeFetch((url) =>
      json(url.includes("skip=0&") ? page(0, 100) : page(100, 30)),
    );
    const result = await createPublicJobCollector({ fetch: fn }).collect("LEVER", "palantir");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.lever.co/v0/postings/palantir?mode=json&skip=0&limit=100",
      "https://api.lever.co/v0/postings/palantir?mode=json&skip=100&limit=100",
    ]);
    expect(result.status).toBe("complete");
    expect(result.postings).toHaveLength(130);
    expect(result.postings[0]).toMatchObject({
      jobUrl: "https://jobs.lever.co/palantir/id-0",
      postedOn: "2026-09-20",
    });
  });

  it.each([json({}, 500), json({ unexpected: [] }), new Response("bad json")])(
    "keeps earlier pages when a later page fails, as partial (%#)",
    async (response) => {
      const { fn } = fakeFetch((url) => (url.includes("skip=0&") ? json(page(0, 100)) : response));
      const result = await createPublicJobCollector({ fetch: fn }).collect("LEVER", "palantir");
      expect(result).toMatchObject({ status: "partial", reason: "PAGE_FAILED" });
      expect(result.postings).toHaveLength(100);
    },
  );
});

it("does not claim a complete Lever scan after overlapping pages", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, text: `Role ${i}` }));
  const { fn } = fakeFetch((url) => json(url.includes("skip=0&") ? first : first.slice(0, 10)));
  const result = await createPublicJobCollector({ fetch: fn }).collect("LEVER", "acme");
  expect(result).toMatchObject({ status: "partial", reason: "COUNT_MISMATCH" });
  expect(result.postings).toHaveLength(100);
});

it("skips an invalid Lever date without losing the other postings", async () => {
  const { fn } = fakeFetch(() =>
    json([
      { id: "bad", text: "Bad date", createdAt: 8640000000000001 },
      { id: "good", text: "Good" },
    ]),
  );
  const result = await createPublicJobCollector({ fetch: fn }).collect("LEVER", "acme");
  expect(result).toMatchObject({ status: "partial", reason: "INVALID_POSTINGS" });
  expect(result.postings.map((p) => p.postingId)).toEqual(["good"]);
});

it("skips impossible calendar dates before a posting can poison a saved chunk", async () => {
  const { fn } = fakeFetch(() =>
    json({
      jobs: [
        { id: 1, title: "Bad", first_published: "2026-02-30T12:00:00Z" },
        { id: 2, title: "Good" },
      ],
    }),
  );
  const result = await createPublicJobCollector({ fetch: fn }).collect("GREENHOUSE", "acme");
  expect(result).toMatchObject({ status: "partial", reason: "INVALID_POSTINGS" });
  expect(result.postings.map((p) => p.postingId)).toEqual(["2"]);
});

it("decodes escaped Greenhouse HTML, including numeric entities", async () => {
  const { fn } = fakeFetch(() =>
    json({
      jobs: [
        {
          id: 1,
          title: "Engineer",
          content:
            "&amp;lt;p&amp;gt;Build &amp;amp; ship &amp;#x2014; it&amp;#39;s ready&amp;lt;/p&amp;gt;",
        },
      ],
    }),
  );
  const result = await createPublicJobCollector({ fetch: fn }).collect("GREENHOUSE", "acme");
  expect(result.postings[0]?.description).toBe("Build & ship — it's ready");
});

describe("Ashby collection", () => {
  it("reads the documented posting API and skips unlisted jobs", async () => {
    const { fn, calls } = fakeFetch(() =>
      json({
        jobs: [
          {
            id: "34413f8d",
            title: "Security Engineer",
            location: "New York, NY",
            descriptionPlain: "About Ramp",
            publishedAt: "2026-04-07T17:12:35.753+00:00",
            isListed: true,
          },
          { id: "hidden", title: "Internal", isListed: false },
        ],
      }),
    );
    const result = await createPublicJobCollector({ fetch: fn }).collect("ASHBY", "ramp");
    expect(calls[0]!.url).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp");
    expect(result.status).toBe("complete");
    expect(result.postings).toEqual([
      {
        postingId: "34413f8d",
        title: "Security Engineer",
        location: "New York, NY",
        jobUrl: "https://jobs.ashbyhq.com/ramp/34413f8d",
        description: "About Ramp",
        postedOn: "2026-04-07",
      },
    ]);
  });
});

describe("Workday collection", () => {
  const ID = "acme/wd5/External";
  const API = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs";
  const postings = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      title: `Role ${from + i}`,
      externalPath: `/job/Austin/Role_JR${from + i}`,
      locationsText: "Austin, TX",
      postedOn: "Posted Today",
    }));
  function workday(total: number, pageOverride?: (offset: number) => Response | undefined) {
    return fakeFetch((_url, init) => {
      const { offset } = JSON.parse(String(init?.body)) as { offset: number };
      const override = pageOverride?.(offset);
      if (override) return override;
      const count = Math.max(0, Math.min(20, Math.min(total, 2000) - offset));
      return json({ total: offset === 0 ? total : 0, jobPostings: postings(offset, count) });
    });
  }

  it("pages 20 at a time from the reported total and never invents dates", async () => {
    const { fn, calls } = workday(45);
    const result = await createPublicJobCollector({ fetch: fn }).collect("WORKDAY", ID);
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).offset).sort((a, b) => a - b)).toEqual(
      [0, 20, 40],
    );
    expect(calls.every((c) => c.url === API && c.init?.method === "POST")).toBe(true);
    expect(result).toMatchObject({ status: "complete", reason: null, reportedTotal: 45 });
    expect(result.postings).toHaveLength(45);
    expect(result.postings[0]).toEqual({
      postingId: "/job/Austin/Role_JR0",
      title: "Role 0",
      location: "Austin, TX",
      jobUrl: "https://acme.wd5.myworkdayjobs.com/External/job/Austin/Role_JR0",
      description: null,
      postedOn: null,
    });
  });

  it("treats a total at the 2000 cap as partial even after reading every page", async () => {
    const { fn, calls } = workday(2000);
    const result = await createPublicJobCollector({ fetch: fn }).collect("WORKDAY", ID);
    expect(calls).toHaveLength(100);
    expect(result).toMatchObject({
      status: "partial",
      reason: "TOTAL_CAPPED",
      reportedTotal: 2000,
    });
    expect(result.postings).toHaveLength(2000);
  });

  it("reports a shortfall from postings shifting between pages as partial", async () => {
    // Page 20 repeats page 0, as when a new posting pushes the list down mid-scan.
    const { fn } = workday(40, (offset) =>
      offset === 20 ? json({ total: 0, jobPostings: postings(0, 20) }) : undefined,
    );
    const result = await createPublicJobCollector({ fetch: fn }).collect("WORKDAY", ID);
    expect(result).toMatchObject({ status: "partial", reason: "COUNT_MISMATCH" });
  });

  it("keeps pages already read when another page fails", async () => {
    const { fn } = workday(60, (offset) => (offset === 40 ? json({}, 500) : undefined));
    const result = await createPublicJobCollector({ fetch: fn }).collect("WORKDAY", ID);
    expect(result).toMatchObject({ status: "partial", reason: "PAGE_FAILED" });
    expect(result.postings.length).toBeGreaterThanOrEqual(20);
  });

  it("treats a contradictory zero total with nonempty postings as partial", async () => {
    const { fn } = fakeFetch(() => json({ total: 0, jobPostings: postings(0, 20) }));
    expect(await createPublicJobCollector({ fetch: fn }).collect("WORKDAY", ID)).toMatchObject({
      status: "partial",
      reason: "COUNT_MISMATCH",
    });
  });

  it("fails a missing board and times out slow ones", async () => {
    const missing = createPublicJobCollector({ fetch: fakeFetch(() => json({}, 404)).fn });
    expect(await missing.collect("WORKDAY", ID)).toMatchObject({
      status: "failed",
      reason: "BOARD_NOT_FOUND",
    });
    const slow = createPublicJobCollector({
      fetch: fakeFetch(() => new Promise<Response>(() => {})).fn,
      timeoutMs: 20,
    });
    expect(await slow.collect("WORKDAY", ID)).toMatchObject({
      status: "failed",
      reason: "TIME_LIMIT",
    });
  });
});

it("never requests an invalid identifier", async () => {
  const { fn, calls } = fakeFetch(() => json({ jobs: [] }));
  const collector = createPublicJobCollector({ fetch: fn });
  expect(await collector.collect("GREENHOUSE", "../x")).toMatchObject({ status: "failed" });
  expect(await collector.collect("WORKDAY", "evil.example/wd5/x")).toMatchObject({
    status: "failed",
  });
  expect(calls).toEqual([]);
});

it.each([5000, 5001])("reports the full-board posting cap as partial (%i)", async (count) => {
  const { fn } = fakeFetch(() =>
    json({ jobs: Array.from({ length: count }, (_, i) => ({ id: i, title: `Role ${i}` })) }),
  );
  const result = await createPublicJobCollector({ fetch: fn }).collect("GREENHOUSE", "acme");
  expect(result).toMatchObject({ status: "partial", reason: "POSTING_LIMIT" });
  expect(result.postings).toHaveLength(5000);
});
