import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { boardNameCandidates, hostOf, simplifyCompanyName } from "../src/discovery/candidates";
import { createPublicBoardDirectory } from "../src/discovery/directory";
import { createFixtureBoardDirectory } from "../src/discovery/fixtures";
import { rateBoard } from "../src/discovery/rank";
import type { ProbeOutcome } from "../src/discovery/types";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };

const found = (
  boardName: string | null,
  openJobs = 10,
  website: string | null = null,
): ProbeOutcome => ({
  status: "found",
  boardName,
  website,
  openJobs,
  openJobsAtLeast: false,
  sampleTitles: ["Engineer"],
});

describe("boardNameCandidates", () => {
  it("builds joined, hyphenated, trimmed, and domain names, most specific first", () => {
    expect(boardNameCandidates("Stripe")).toEqual(["stripe"]);
    expect(boardNameCandidates("Scale AI")).toEqual(["scaleai", "scale-ai", "scale"]);
    expect(boardNameCandidates("Palantir Technologies, Inc.")).toEqual([
      "palantirtechnologies",
      "palantir-technologies",
      "palantir",
    ]);
    expect(boardNameCandidates("Notion Labs", "https://www.notion.so/careers")).toEqual([
      "notionlabs",
      "notion-labs",
      "notion",
    ]);
    expect(boardNameCandidates("Crème & Co")).toEqual(["cremeand", "creme-and"]);
    expect(boardNameCandidates("Acme", "https://jobs.acme-robotics.com")).toEqual([
      "acme",
      "acme-robotics",
    ]);
  });

  it("never exceeds five candidates and drops invalid ones", () => {
    const list = boardNameCandidates("Alpha Beta Gamma Labs AI", "https://delta.io");
    expect(list.length).toBeLessThanOrEqual(5);
    expect(boardNameCandidates("!!!")).toEqual([]);
  });

  it("simplifies names and hosts for comparison", () => {
    expect(simplifyCompanyName("Palantir Technologies")).toBe("palantir");
    expect(simplifyCompanyName("Scale AI")).toBe("scale");
    expect(simplifyCompanyName("Scale")).toBe("scale");
    expect(hostOf("https://www.ramp.com/")).toBe("ramp.com");
    expect(hostOf("ramp.com")).toBe("ramp.com");
    expect(hostOf("javascript:alert(1)")).toBeNull();
  });
});

describe("rateBoard", () => {
  const base = {
    provider: "ASHBY" as const,
    company: "Notion",
    companyWebsite: null,
    boardIdentifier: "notion",
    candidates: ["notion"],
    fromApplications: false,
  };
  it("rates a matching board name or website high", () => {
    expect(rateBoard({ ...base, outcome: found("Notion") }).confidence).toBe("high");
    expect(
      rateBoard({
        ...base,
        companyWebsite: "https://notion.so",
        outcome: found("Notion Labs Inc", 1, "https://www.notion.so"),
      }).confidence,
    ).toBe("high");
  });
  it("rates similar names medium and different names low", () => {
    expect(rateBoard({ ...base, outcome: found("Notion Hardware") }).confidence).toBe("medium");
    expect(rateBoard({ ...base, outcome: found("Totally Different") })).toMatchObject({
      confidence: "low",
      reasons: ["Board name “Totally Different” differs"],
    });
  });
  it("rates an exact-name board without a shown name medium, else low", () => {
    expect(rateBoard({ ...base, outcome: found(null) }).confidence).toBe("medium");
    expect(
      rateBoard({ ...base, boardIdentifier: "notion-hq", outcome: found(null) }).confidence,
    ).toBe("low");
  });
  it("trusts saved applications but reports a board that disappeared", () => {
    expect(
      rateBoard({ ...base, fromApplications: true, outcome: { status: "error" } }).confidence,
    ).toBe("high");
    expect(
      rateBoard({ ...base, fromApplications: true, outcome: { status: "missing" } }),
    ).toMatchObject({
      confidence: "low",
      reasons: ["Linked from your saved applications", "The board no longer exists"],
    });
  });
});

describe("createPublicBoardDirectory (fake fetch)", () => {
  function fakeFetch(routes: Record<string, { status: number; body: string }>) {
    const calls: string[] = [];
    const fn = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const route = routes[url];
      if (!route) return new Response("Not Found", { status: 404 });
      return new Response(route.body, { status: route.status });
    }) as typeof fetch;
    return { fn, calls };
  }

  it("reads Greenhouse name and job count", async () => {
    const { fn } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/stripe": {
        status: 200,
        body: '{"name":"Stripe","content":""}',
      },
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs": {
        status: 200,
        body: '{"jobs":[{"title":"A"},{"title":"B"}],"meta":{"total":689}}',
      },
    });
    const dir = createPublicBoardDirectory({ fetch: fn });
    expect(await dir.probe("GREENHOUSE", "stripe")).toEqual({
      status: "found",
      boardName: "Stripe",
      website: null,
      openJobs: 689,
      openJobsAtLeast: false,
      sampleTitles: ["A", "B"],
    });
    expect(await dir.probe("GREENHOUSE", "nope")).toEqual({ status: "missing" });
  });

  it("reads Lever postings and the hosted page title", async () => {
    const posts = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ text: `Role ${i}` })));
    const { fn } = fakeFetch({
      "https://api.lever.co/v0/postings/palantir?mode=json&limit=5": { status: 200, body: posts },
      "https://jobs.lever.co/palantir": {
        status: 200,
        body: "<html><head><title>Palantir Technologies</title>",
      },
    });
    const result = await createPublicBoardDirectory({ fetch: fn }).probe("LEVER", "palantir");
    expect(result).toMatchObject({
      status: "found",
      boardName: "Palantir Technologies",
      openJobs: 5,
      openJobsAtLeast: true,
      sampleTitles: ["Role 0", "Role 1", "Role 2"],
    });
  });

  it("reads Ashby organization and postings; null organization is missing", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      calls.push({ url: String(input), body });
      const name = JSON.parse(body).variables.organizationHostedJobsPageName;
      if (String(input).includes("ApiOrganization")) {
        return Response.json({
          data: {
            organization:
              name === "ramp" ? { name: "Ramp", publicWebsite: "https://ramp.com" } : null,
          },
        });
      }
      return Response.json({
        data: { jobBoard: { jobPostings: [{ title: "Engineer" }, { title: "Designer" }] } },
      });
    }) as typeof fetch;
    const dir = createPublicBoardDirectory({ fetch: fn });
    expect(await dir.probe("ASHBY", "ramp")).toMatchObject({
      status: "found",
      boardName: "Ramp",
      website: "https://ramp.com",
      openJobs: 2,
    });
    expect(await dir.probe("ASHBY", "nope")).toEqual({ status: "missing" });
    expect(
      calls.every((c) => c.url.startsWith("https://jobs.ashbyhq.com/api/non-user-graphql")),
    ).toBe(true);
  });

  it("turns server errors, bad JSON, and thrown fetches into status error", async () => {
    const dir = (fn: typeof fetch) => createPublicBoardDirectory({ fetch: fn });
    expect(
      await dir((async () => new Response("x", { status: 500 })) as typeof fetch).probe(
        "GREENHOUSE",
        "a",
      ),
    ).toEqual({ status: "error" });
    expect(
      await dir((async () => new Response("not json", { status: 200 })) as typeof fetch).probe(
        "GREENHOUSE",
        "a",
      ),
    ).toEqual({ status: "error" });
    expect(
      await dir((async () => {
        throw new Error("offline");
      }) as typeof fetch).probe("LEVER", "a"),
    ).toEqual({ status: "error" });
  });

  it("never requests an invalid board name", async () => {
    const { fn, calls } = fakeFetch({});
    expect(await createPublicBoardDirectory({ fetch: fn }).probe("GREENHOUSE", "../admin")).toEqual(
      { status: "missing" },
    );
    expect(calls).toEqual([]);
  });
});

describe("board discovery services", () => {
  function setup(
    directory = createFixtureBoardDirectory({
      GREENHOUSE: { stripe: found("Stripe", 689) },
      LEVER: { stripe: found("Stripe", 3), notion: found("Notion Hardware Co.") },
      ASHBY: { notion: found("Notion", 88, "https://www.notion.so") },
    }),
  ) {
    const repo = new FakeTrackerRepository();
    const services = createTrackerServices({
      repository: repo,
      clock: fixedClock("2026-09-23"),
      boardDirectory: directory,
    });
    return { repo, services, directory };
  }

  it("probes every provider with each candidate and ranks by evidence", async () => {
    const { services, directory } = setup();
    const result = await services.discoverCompanyBoards(
      { company: "Notion", websiteUrl: "https://notion.so" },
      OWNER,
    );
    expect(result.candidates).toEqual(["notion"]);
    expect(directory.calls).toHaveLength(3);
    expect(result.suggestions.map((s) => [s.provider, s.confidence])).toEqual([
      ["ASHBY", "high"],
      ["LEVER", "medium"],
    ]);
    expect(result.suggestions[0]).toMatchObject({
      boardUrl: "https://jobs.ashbyhq.com/notion",
      boardName: "Notion",
      openJobs: 88,
      watchedBy: null,
    });
    expect(result.unavailable).toEqual([]);
  });

  it("adds boards from saved application URLs even when names would not find them", async () => {
    const { services } = setup(
      createFixtureBoardDirectory({ GREENHOUSE: { "acme-careers": found("Acme", 4) } }),
    );
    await services.createApplication(
      {
        requestId: randomUUID(),
        company: "Acme",
        title: "SWE",
        jobUrl: "https://job-boards.greenhouse.io/acme-careers/jobs/1",
      },
      OWNER,
    );
    const result = await services.discoverCompanyBoards({ company: "acme" }, OWNER);
    expect(result.companyId).not.toBeNull();
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        provider: "GREENHOUSE",
        boardIdentifier: "acme-careers",
        fromApplications: true,
        confidence: "high",
        openJobs: 4,
      }),
    ]);
  });

  it("flags boards already watched for another company", async () => {
    const { services } = setup();
    await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "Stripe Inc",
        boards: [{ provider: "LEVER", boardIdentifier: "stripe" }],
      },
      OWNER,
    );
    const result = await services.discoverCompanyBoards({ company: "Stripe" }, OWNER);
    const lever = result.suggestions.find((s) => s.provider === "LEVER")!;
    expect(lever.watchedBy).toMatchObject({ company: "Stripe Inc" });
  });

  it("reports providers it could not reach", async () => {
    const failing = { probe: async () => ({ status: "error" }) as const };
    const { services } = setup(failing as never);
    const result = await services.discoverCompanyBoards({ company: "Stripe" }, OWNER);
    expect(result.suggestions).toEqual([]);
    expect(result.unavailable).toEqual(["GREENHOUSE", "LEVER", "ASHBY"]);
  });

  it("suggests unwatched companies from applications, locally, max three boards each", async () => {
    const { services, directory } = setup();
    const job = (company: string, jobUrl: string | null) =>
      services.createApplication(
        {
          requestId: randomUUID(),
          company,
          title: `SWE ${randomUUID()}`,
          jobUrl,
          allowDuplicate: true,
        },
        OWNER,
      );
    await job("Datadog", "https://job-boards.greenhouse.io/datadog/jobs/1");
    await job("Datadog", "https://boards.greenhouse.io/datadog/jobs/2");
    await job("Ramp", "https://jobs.ashbyhq.com/ramp/abc");
    await job("Ramp", "https://jobs.lever.co/ramp/xyz");
    await job(
      "Workday Co",
      "https://workdayco.wd5.myworkdayjobs.com/en-US/External/job/Austin/Engineer_JR1",
    );
    await job("Custom Careers", "https://careers.custom.example/jobs/1");
    await job("Watched", "https://jobs.lever.co/watched/1");
    await services.addWatchedCompany({ requestId: randomUUID(), company: "Watched" }, OWNER);

    const suggestions = await services.suggestWatchesFromApplications(OWNER);
    expect(
      suggestions.map((s) => [
        s.company,
        s.applicationCount,
        s.boards.map((b) => `${b.provider}:${b.boardIdentifier}`),
      ]),
    ).toEqual([
      ["Datadog", 2, ["GREENHOUSE:datadog"]],
      ["Ramp", 2, ["ASHBY:ramp", "LEVER:ramp"]],
      ["Workday Co", 1, ["WORKDAY:workdayco/wd5/External"]],
    ]);
    expect(directory.calls).toEqual([]);
  });
});
