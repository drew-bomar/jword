import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { createPublicBoardDirectory } from "../src/discovery/directory";
import { createFixtureBoardDirectory } from "../src/discovery/fixtures";
import { rateBoard } from "../src/discovery/rank";
import type { ProbeOutcome } from "../src/discovery/types";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";
import {
  canonicalBoardUrl,
  inferBoardFromUrl,
  isValidBoardIdentifier,
  parseWorkdayIdentifier,
} from "../src/watchlist/boards";
import { boardInputSchema, discoverBoardsSchema } from "../src/watchlist/schemas";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const NVIDIA = "nvidia/wd5/NVIDIAExternalCareerSite";
const NVIDIA_URL = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite";

describe("Workday URL recognition (decision 022)", () => {
  const supported: Array<[string, string]> = [
    // Board pages, with and without a locale prefix.
    ["https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", NVIDIA],
    ["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite", NVIDIA],
    ["nvidia.wd5.myworkdayjobs.com/fr-CA/NVIDIAExternalCareerSite/", NVIDIA],
    // Individual postings, as the extension and saved applications see them.
    [
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Architect_JR2001099-1?source=LinkedIn",
      NVIDIA,
    ],
    [
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/details/Senior-Architect_JR2001099#apply",
      NVIDIA,
    ],
    // Hostnames are case-insensitive; the site keeps its case.
    ["https://NVIDIA.WD5.MyWorkdayJobs.com/NVIDIAExternalCareerSite", NVIDIA],
    // The myworkdaysite.com family names the same board.
    ["https://wd5.myworkdaysite.com/recruiting/nvidia/NVIDIAExternalCareerSite", NVIDIA],
    ["https://wd5.myworkdaysite.com/en-US/recruiting/nvidia/NVIDIAExternalCareerSite", NVIDIA],
    [
      "https://wd5.myworkdaysite.com/en-US/recruiting/NVIDIA/NVIDIAExternalCareerSite/job/Remote/Engineer_JR1?q=1",
      NVIDIA,
    ],
    ["https://acme-co.wd1.myworkdayjobs.com/External_Careers", "acme-co/wd1/External_Careers"],
    ["https://acme.wd103.myworkdayjobs.com/Careers", "acme/wd103/Careers"],
  ];
  for (const [input, identifier] of supported) {
    it(`recognizes ${input}`, () => {
      expect(inferBoardFromUrl(input)).toEqual({
        provider: "WORKDAY",
        boardIdentifier: identifier,
        boardUrl: canonicalBoardUrl("WORKDAY", identifier),
      });
    });
  }

  const rejected = [
    "https://nvidia.wd5.myworkdayjobs.com/",
    "https://nvidia.wd5.myworkdayjobs.com/en-US",
    "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
    "https://nvidia.myworkdayjobs.com/NVIDIAExternalCareerSite",
    "https://nvidia.wdx.myworkdayjobs.com/NVIDIAExternalCareerSite",
    "https://nvidia.wd5.myworkdayjobs.com.evil.example/NVIDIAExternalCareerSite",
    "https://evil.example/nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    "https://a.b.wd5.myworkdayjobs.com/Site",
    "https://under_score.wd5.myworkdayjobs.com/Site",
    "https://-acme.wd5.myworkdayjobs.com/Site",
    "https://nvidia.wd5.myworkdayjobs-impl.com/NVIDIAExternalCareerSite",
    "https://nvidia.wd5.myworkday.com/nvidia/d/home.htmld",
    "https://wd5.myworkdaysite.com/nvidia/NVIDIAExternalCareerSite",
    "https://wd5.myworkdaysite.com/recruiting/nvidia",
    "https://nvidia.wd5.myworkdayjobs.com/Site%2Fother",
    "https://nvidia.wd5.myworkdayjobs.com/has.dot",
    `https://nvidia.wd5.myworkdayjobs.com/${"s".repeat(101)}`,
    "ftp://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    "https://careers.nvidia.com/jobs",
  ];
  for (const input of rejected) {
    it(`rejects ${input.slice(0, 90)}`, () => {
      expect(inferBoardFromUrl(input)).toBeNull();
    });
  }

  it("parses, validates, and derives the canonical URL from the identifier alone", () => {
    expect(parseWorkdayIdentifier(NVIDIA)).toEqual({
      account: "nvidia",
      cluster: "wd5",
      site: "NVIDIAExternalCareerSite",
    });
    expect(canonicalBoardUrl("WORKDAY", NVIDIA)).toBe(NVIDIA_URL);
    for (const bad of [
      "nvidia",
      "NVIDIA/wd5/Site",
      "nvidia/WD5/Site",
      "nvidia/wd/Site",
      "nvidia/wd5/",
      "nvidia/wd5/Site/extra",
      "nvidia/wd5/has.dot",
      "a_b/wd5/Site",
      `${"a".repeat(64)}/wd5/Site`,
    ]) {
      expect(isValidBoardIdentifier("WORKDAY", bad), bad).toBe(false);
      expect(canonicalBoardUrl("WORKDAY", bad), bad).toBe("");
    }
    // The name-based rule never accepts a Workday identifier, and vice versa.
    expect(isValidBoardIdentifier("LEVER", NVIDIA)).toBe(false);
    expect(isValidBoardIdentifier("WORKDAY", "nvidia")).toBe(false);
  });

  it("validates Workday boards per provider at the boundary", () => {
    expect(
      boardInputSchema.safeParse({ provider: "WORKDAY", boardIdentifier: NVIDIA }).success,
    ).toBe(true);
    const bad = boardInputSchema.safeParse({ provider: "WORKDAY", boardIdentifier: "nvidia" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/account\/cluster\/site/);
    expect(
      boardInputSchema.safeParse({ provider: "GREENHOUSE", boardIdentifier: NVIDIA }).success,
    ).toBe(false);
  });
});

describe("Workday board check (fake fetch)", () => {
  function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      // Like the real fetch, give up when the directory's timeout aborts the request.
      const aborted = new Promise<never>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
      return Promise.race([respond(url), aborted]);
    }) as typeof fetch;
    return { fn, calls };
  }
  const API = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";
  const page = (total: number, titles: string[]) =>
    new Response(JSON.stringify({ total, jobPostings: titles.map((title) => ({ title })) }));

  it("posts one small first-page query and reports the total and sample titles", async () => {
    const { fn, calls } = fakeFetch(() => page(412, ["A", "B", "C"]));
    const result = await createPublicBoardDirectory({ fetch: fn }).probe("WORKDAY", NVIDIA);
    expect(result).toEqual({
      status: "found",
      boardName: null,
      website: null,
      openJobs: 412,
      openJobsAtLeast: false,
      sampleTitles: ["A", "B", "C"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(API);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      appliedFacets: {},
      limit: 3,
      offset: 0,
      searchText: "",
    });
  });

  it("treats a total at Workday's reporting cap as a lower bound", async () => {
    const { fn } = fakeFetch(() => page(2000, ["A"]));
    expect(await createPublicBoardDirectory({ fetch: fn }).probe("WORKDAY", NVIDIA)).toMatchObject({
      openJobs: 2000,
      openJobsAtLeast: true,
    });
  });

  it("only 404 means missing; 422, server errors, bad JSON, and timeouts are unverified", async () => {
    const outcome = async (respond: () => Response | Promise<Response>, timeoutMs?: number) =>
      createPublicBoardDirectory({ fetch: fakeFetch(respond).fn, timeoutMs }).probe(
        "WORKDAY",
        NVIDIA,
      );
    expect(await outcome(() => new Response("{}", { status: 404 }))).toEqual({ status: "missing" });
    expect(await outcome(() => new Response("{}", { status: 422 }))).toEqual({ status: "error" });
    expect(await outcome(() => new Response("oops", { status: 500 }))).toEqual({ status: "error" });
    expect(await outcome(() => new Response("<html>"))).toEqual({ status: "error" });
    expect(await outcome(() => new Response('{"jobPostings":[]}'))).toEqual({ status: "error" });
    expect(await outcome(() => new Promise<Response>(() => {}), 20)).toEqual({ status: "error" });
  });

  it("never requests an invalid identifier, so the host cannot leave myworkdayjobs.com", async () => {
    const { fn, calls } = fakeFetch(() => page(1, ["A"]));
    const dir = createPublicBoardDirectory({ fetch: fn });
    for (const bad of ["evil.example/wd5/Site", "nvidia/wd5/../x", "nvidia", "a@b/wd5/Site"]) {
      expect(await dir.probe("WORKDAY", bad)).toEqual({ status: "missing" });
    }
    expect(calls).toEqual([]);
  });
});

describe("Workday in discovery", () => {
  const found = (openJobs: number): ProbeOutcome => ({
    status: "found",
    boardName: null,
    website: null,
    openJobs,
    openJobsAtLeast: false,
    sampleTitles: ["Engineer"],
  });
  function setup() {
    const directory = createFixtureBoardDirectory({
      WORKDAY: { [NVIDIA.toLowerCase()]: found(412) },
      LEVER: { nvidia: found(3) },
    });
    const services = createTrackerServices({
      repository: new FakeTrackerRepository(),
      clock: fixedClock("2026-09-24"),
      boardDirectory: directory,
    });
    return { services, directory };
  }

  it("never guesses Workday boards from a company name", async () => {
    const { services, directory } = setup();
    const result = await services.discoverCompanyBoards({ company: "NVIDIA" }, OWNER);
    expect(directory.calls.map((c) => c.provider)).toEqual(["GREENHOUSE", "LEVER", "ASHBY"]);
    expect(result.suggestions.map((s) => s.provider)).toEqual(["LEVER"]);
    expect(result.unavailable).toEqual([]);
  });

  it("checks a saved Workday application link and rates it high", async () => {
    const { services, directory } = setup();
    await services.createApplication(
      {
        requestId: randomUUID(),
        company: "NVIDIA",
        title: "Architect",
        jobUrl: `${NVIDIA_URL.replace(".com/", ".com/en-US/")}/job/US-CA/Architect_JR1`,
      },
      OWNER,
    );
    const result = await services.discoverCompanyBoards({ company: "NVIDIA" }, OWNER);
    expect(directory.calls[0]).toEqual({ provider: "WORKDAY", identifier: NVIDIA });
    expect(result.suggestions[0]).toMatchObject({
      provider: "WORKDAY",
      boardIdentifier: NVIDIA,
      boardUrl: NVIDIA_URL,
      confidence: "high",
      fromApplications: true,
      requested: false,
      openJobs: 412,
    });
  });

  it("checks supplied board links first, reports missing ones, and never fetches careers pages", async () => {
    const { services, directory } = setup();
    const result = await services.discoverCompanyBoards(
      {
        company: "NVIDIA",
        boardUrls: [
          "https://careers.nvidia.example/jobs",
          "https://wd5.myworkdaysite.com/en-US/recruiting/nvidia/NVIDIAExternalCareerSite",
          "https://acme.wd1.myworkdayjobs.com/Gone",
        ],
      },
      OWNER,
    );
    expect(directory.calls.slice(0, 2)).toEqual([
      { provider: "WORKDAY", identifier: NVIDIA },
      { provider: "WORKDAY", identifier: "acme/wd1/Gone" },
    ]);
    expect(directory.calls.some((c) => c.identifier.includes("careers"))).toBe(false);
    const byId = new Map(result.suggestions.map((s) => [s.boardIdentifier, s]));
    // Account "nvidia" equals the company name: medium, like other boards that show no name.
    expect(byId.get(NVIDIA)).toMatchObject({
      requested: true,
      confidence: "medium",
      openJobs: 412,
    });
    expect(byId.get("acme/wd1/Gone")).toMatchObject({
      requested: true,
      confidence: "low",
      reasons: ["The board no longer exists"],
    });
  });

  it("accepts one supplied link as a single query-string value and caps the list at three", () => {
    expect(discoverBoardsSchema.parse({ company: "X", boardUrls: NVIDIA_URL }).boardUrls).toEqual([
      NVIDIA_URL,
    ]);
    expect(
      discoverBoardsSchema.safeParse({ company: "X", boardUrls: ["a", "b", "c", "d"] }).success,
    ).toBe(false);
  });

  it("matches the Workday account, not the whole identifier, against the company name", () => {
    const base = {
      provider: "WORKDAY" as const,
      company: "NVIDIA",
      companyWebsite: null,
      candidates: ["nvidia"],
      fromApplications: false,
      outcome: found(10),
    };
    expect(rateBoard({ ...base, boardIdentifier: NVIDIA }).confidence).toBe("medium");
    expect(rateBoard({ ...base, boardIdentifier: "other/wd5/Site" }).confidence).toBe("low");
  });
});
