import { afterEach, describe, expect, it, vi } from "vitest";
import { createWatchlistServices, MAX_DISCOVERY_PROBES } from "../src/services/watchlist";
import { FakeTrackerRepository } from "../src/testing/fake-repository";
import { createPublicBoardDirectory } from "../src/discovery/directory";
import { createCachedBoardDirectory } from "../src/discovery/cache";
import { createFixtureBoardDirectory } from "../src/discovery/fixtures";
import { JwordError } from "../src/domain/errors";
import { boardsSchema } from "../src/watchlist/schemas";
import type { ProbeOutcome } from "../src/discovery/types";
import { watchBoardContract } from "../../../tests/fixtures/watch-board-contract";

const actor = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" as const };
const found: ProbeOutcome = {
  status: "found",
  boardName: "Stripe",
  website: null,
  openJobs: 2,
  openJobsAtLeast: false,
  sampleTitles: ["Engineer"],
};
afterEach(() => vi.useRealTimers());

describe("discovery reliability", () => {
  it.each(watchBoardContract)("shared board contract: $name", ({ boards, valid }) => {
    expect(boardsSchema.safeParse(boards).success).toBe(valid);
  });
  it("reports a partial failure when other candidates are missing", async () => {
    const services = createWatchlistServices({
      repository: new FakeTrackerRepository(),
      boardDirectory: {
        probe: async (provider, id) => ({
          status: provider === "ASHBY" && id === "scaleai" ? "error" : "missing",
        }),
      },
    });
    const result = await services.discoverCompanyBoards({ company: "Scale AI" }, actor);
    expect(result.unavailable).toEqual([]);
    expect(result.incomplete).toEqual(["ASHBY"]);
  });

  it("bounds all probes, retaining unverified local evidence", async () => {
    const repository = new FakeTrackerRepository();
    repository.findCompanyByName = async () => ({
      companyId: actor.userId,
      name: "Stripe",
      websiteUrl: null,
    });
    repository.listCompanyJobUrls = async () =>
      Array.from({ length: 20 }, (_, i) => `https://jobs.lever.co/board${i}/job`);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "missing" }));
    const result = await createWatchlistServices({
      repository,
      boardDirectory: { probe },
    }).discoverCompanyBoards({ company: "Stripe" }, actor);
    expect(probe).toHaveBeenCalledTimes(MAX_DISCOVERY_PROBES);
    expect(result.suggestions).toHaveLength(20);
    expect(result.warnings.join(" ")).toContain("unverified");
    expect(
      result.suggestions.find((s) => s.boardIdentifier === "board19")?.reasons.join(" "),
    ).toContain("Could not reach");
  });

  it("cancels waiting and stops launching queued probes", async () => {
    const controller = new AbortController();
    const probe = vi.fn(() => new Promise<ProbeOutcome>(() => {}));
    const pending = createWatchlistServices({
      repository: new FakeTrackerRepository(),
      boardDirectory: { probe },
    }).discoverCompanyBoards(
      { company: "Alpha Beta Labs", websiteUrl: "https://example.com" },
      actor,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(6));
    controller.abort();
    const result = await pending;
    expect(probe).toHaveBeenCalledTimes(6);
    expect(result.unavailable).toHaveLength(3);
  });

  it("keeps public evidence when optional local reads fail, without claiming ownership", async () => {
    const repository = new FakeTrackerRepository();
    repository.findCompanyByName = async () => {
      throw new JwordError("INTERNAL_ERROR", "offline");
    };
    repository.listWatchSummaries = async () => {
      throw new JwordError("INTERNAL_ERROR", "offline");
    };
    const services = createWatchlistServices({
      repository,
      boardDirectory: createFixtureBoardDirectory({ GREENHOUSE: { stripe: found } }),
    });
    const result = await services.discoverCompanyBoards({ company: "Stripe" }, actor);
    expect(result.suggestions).toHaveLength(1);
    expect(result.ownershipChecked).toBe(false);
    expect(result.warnings).toHaveLength(2);
  });

  it("never degrades authorization errors or a selected company failure", async () => {
    const repository = new FakeTrackerRepository();
    const directory = createFixtureBoardDirectory({});
    const services = createWatchlistServices({ repository, boardDirectory: directory });
    await expect(
      services.discoverCompanyBoards({ companyId: actor.userId }, actor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    repository.findCompanyByName = async () => {
      throw new JwordError("FORBIDDEN", "no");
    };
    await expect(
      services.discoverCompanyBoards({ company: "Stripe" }, actor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(directory.calls).toEqual([]);
  });

  it("cancellation also stops waiting for local enrichment", async () => {
    const repository = new FakeTrackerRepository();
    repository.findCompanyByName = vi.fn(() => new Promise<never>(() => {}));
    const directory = createFixtureBoardDirectory({});
    const controller = new AbortController();
    const pending = createWatchlistServices({
      repository,
      boardDirectory: directory,
    }).discoverCompanyBoards({ company: "Stripe" }, actor, { signal: controller.signal });
    await vi.waitFor(() => expect(repository.findCompanyByName).toHaveBeenCalled());
    controller.abort();
    expect((await pending).ownershipChecked).toBe(false);
    expect(directory.calls).toEqual([]);
  });

  it("rejects duplicate canonical URLs across provider shapes", () => {
    expect(
      boardsSchema.safeParse([
        { provider: "GREENHOUSE", boardIdentifier: "review" },
        { provider: "OTHER", boardUrl: "https://job-boards.greenhouse.io/review" },
      ]).success,
    ).toBe(false);
  });
});

describe("provider response boundaries", () => {
  it("rejects malformed successful responses instead of inventing empty boards", async () => {
    const directory = createPublicBoardDirectory({
      fetch: async () => Response.json({ error: "changed contract" }),
    });
    for (const provider of ["LEVER", "GREENHOUSE", "ASHBY"] as const) {
      expect(await directory.probe(provider, "review")).toEqual({ status: "error" });
    }
  });

  it("uses the documented Ashby fallback without claiming company identity", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return String(input).includes("posting-api/job-board/")
        ? Response.json({
            jobs: [
              { title: "Engineer", isListed: true },
              { title: "Private", isListed: false },
            ],
          })
        : Response.json({ data: {} });
    });
    const result = await createPublicBoardDirectory({ fetch }).probe("ASHBY", "review");
    expect(result).toMatchObject({
      status: "found",
      boardName: null,
      website: null,
      openJobs: 1,
      sampleTitles: ["Engineer"],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("enforces response byte limits", async () => {
    const directory = createPublicBoardDirectory({
      fetch: async () => new Response(" ".repeat(5_000_001)),
    });
    expect(await directory.probe("LEVER", "review")).toEqual({ status: "error" });
  });
});

describe("public evidence cache", () => {
  it("deduplicates requests and one subscriber's cancellation does not cancel another", async () => {
    let resolve!: (value: ProbeOutcome) => void;
    const probe = vi.fn(
      () =>
        new Promise<ProbeOutcome>((r) => {
          resolve = r;
        }),
    );
    const directory = createCachedBoardDirectory({ probe });
    const controller = new AbortController();
    const first = directory.probe("LEVER", "stripe", controller.signal);
    const second = directory.probe("LEVER", "stripe");
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await first).toEqual({ status: "error" });
    resolve(found);
    expect(await second).toEqual(found);
    expect(await directory.probe("LEVER", "stripe")).toEqual(found);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("cancels unused work and does not cache cancellation", async () => {
    let signal: AbortSignal | undefined;
    const probe = vi.fn(async (_p, _id, s?: AbortSignal): Promise<ProbeOutcome> => {
      signal = s;
      return new Promise(() => {});
    });
    const directory = createCachedBoardDirectory({ probe });
    const controller = new AbortController();
    const first = directory.probe("LEVER", "stripe", controller.signal);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    controller.abort();
    await first;
    expect(signal?.aborted).toBe(true);
    probe.mockImplementation(async () => found);
    expect(await directory.probe("LEVER", "stripe")).toEqual(found);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("bounds concurrent work and queued requests", async () => {
    let resolve!: (value: ProbeOutcome) => void;
    const probe = vi.fn(
      () =>
        new Promise<ProbeOutcome>((r) => {
          resolve = r;
        }),
    );
    const directory = createCachedBoardDirectory({ probe }, { concurrency: 1, maxQueue: 1 });
    const a = directory.probe("LEVER", "a");
    const b = directory.probe("LEVER", "b");
    expect(await directory.probe("LEVER", "c")).toEqual({ status: "error" });
    expect(probe).toHaveBeenCalledTimes(1);
    resolve(found);
    await a;
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    resolve(found);
    await b;
  });

  it("expires evidence and evicts entries at the size bound", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => found);
    const directory = createCachedBoardDirectory({ probe }, { ttlMs: 10, maxEntries: 1 });
    await directory.probe("LEVER", "a");
    await directory.probe("LEVER", "a");
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11);
    await directory.probe("LEVER", "a");
    await directory.probe("LEVER", "b");
    await directory.probe("LEVER", "a");
    expect(probe).toHaveBeenCalledTimes(4);
  });
});
