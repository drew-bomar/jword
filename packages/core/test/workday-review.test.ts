import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCachedBoardDirectory } from "../src/discovery/cache";
import { createFixtureBoardDirectory } from "../src/discovery/fixtures";
import type { ProbeOutcome } from "../src/discovery/types";
import { fixedClock } from "../src/domain/dates";
import { createTrackerServices } from "../src/services";
import { FakeTrackerRepository } from "../src/testing/fake-repository";
import { inferBoardFromUrl } from "../src/watchlist/boards";
import { selectWatchBoard } from "../src/watchlist/selection";
import type { WatchBoard } from "../src/watchlist/types";

const actor = { userId: randomUUID(), actorType: "USER" as const };
const url = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite";
const board = inferBoardFromUrl(url)!;
const found: ProbeOutcome = {
  status: "found",
  boardName: null,
  website: null,
  openJobs: 4,
  openJobsAtLeast: false,
  sampleTitles: ["Engineer"],
};
function setup() {
  const repository = new FakeTrackerRepository();
  const directory = createFixtureBoardDirectory({
    WORKDAY: { [board.boardIdentifier.toLowerCase()]: found },
  });
  return {
    repository,
    directory,
    services: createTrackerServices({
      repository,
      boardDirectory: directory,
      clock: fixedClock("2026-09-25"),
    }),
  };
}

describe("Workday review regressions", () => {
  it("discovers a Workday URL entered as the company website", async () => {
    const { services, directory } = setup();
    const result = await services.discoverCompanyBoards(
      { company: "NVIDIA", websiteUrl: url },
      actor,
    );
    expect(directory.calls[0]).toEqual({ provider: "WORKDAY", identifier: board.boardIdentifier });
    expect(result.suggestions[0]).toMatchObject({
      provider: "WORKDAY",
      confidence: "high",
      verification: "found",
    });
  });

  it("also uses a saved company website without requiring an application", async () => {
    const { services } = setup();
    const watch = await services.addWatchedCompany(
      { requestId: randomUUID(), company: "NVIDIA", websiteUrl: url },
      actor,
    );
    const result = await services.discoverCompanyBoards({ companyId: watch.companyId }, actor);
    expect(result.suggestions[0]?.boardUrl).toBe(url);
  });

  it("verification only probes supplied boards, deduplicates aliases, and skips application reads", async () => {
    const { services, directory, repository } = setup();
    const watch = await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "A Long Company Name Inc",
        websiteUrl: "https://jobs.lever.co/unrelated",
      },
      actor,
    );
    const read = vi.spyOn(repository, "listCompanyJobUrls");
    const result = await services.discoverCompanyBoards(
      {
        companyId: watch.companyId,
        mode: "verify",
        boardUrls: [
          url,
          "https://wd5.myworkdaysite.com/recruiting/nvidia/NVIDIAExternalCareerSite",
        ],
      },
      actor,
    );
    expect(read).not.toHaveBeenCalled();
    expect(directory.calls).toEqual([{ provider: "WORKDAY", identifier: board.boardIdentifier }]);
    expect(result.candidates).toEqual([]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.ownershipChecked).toBe(true);
  });

  it("verification rejects missing links and arbitrary websites without probing", async () => {
    const { services, directory } = setup();
    for (const boardUrls of [undefined, [], ["https://example.com/careers"]]) {
      await expect(
        services.discoverCompanyBoards({ company: "NVIDIA", mode: "verify", boardUrls }, actor),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(directory.calls).toHaveLength(0);
  });

  it("verification retains missing-board evidence and fresh watch ownership", async () => {
    const { services } = setup();
    const watch = await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "NVIDIA",
        boards: [{ provider: "WORKDAY", boardIdentifier: board.boardIdentifier }],
      },
      actor,
    );
    const result = await services.discoverCompanyBoards(
      {
        company: "Another Company",
        mode: "verify",
        boardUrls: [url, "https://acme.wd5.myworkdayjobs.com/Gone"],
      },
      actor,
    );
    expect(result.suggestions.find((item) => item.boardUrl === url)?.watchedBy?.watchId).toBe(
      watch.watchId,
    );
    expect(
      result.suggestions.find((item) => item.boardIdentifier.endsWith("/Gone"))?.verification,
    ).toBe("missing");
  });

  it("upgrades a legacy Other URL in place even with three selected boards", () => {
    const legacy: WatchBoard = {
      provider: "OTHER",
      boardIdentifier: null,
      boardUrl:
        "https://wd5.myworkdaysite.com/en-US/recruiting/nvidia/NVIDIAExternalCareerSite/job/Engineer_JR1",
    };
    const other = inferBoardFromUrl("https://jobs.lever.co/acme")!;
    const third = inferBoardFromUrl("https://jobs.ashbyhq.com/acme")!;
    expect(selectWatchBoard([other, legacy, third], board)).toEqual([other, board, third]);
    expect(selectWatchBoard([other, board, third], board)).toEqual([other, board, third]);
  });

  it("case variants share an in-flight probe and its cached result while preserving request case", async () => {
    let finish!: (value: ProbeOutcome) => void;
    const probe = vi.fn(
      () =>
        new Promise<ProbeOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const cache = createCachedBoardDirectory({ probe });
    const first = cache.probe("WORKDAY", board.boardIdentifier);
    const second = cache.probe("WORKDAY", board.boardIdentifier.toLowerCase());
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(probe.mock.calls[0]).toEqual([
      "WORKDAY",
      board.boardIdentifier,
      expect.any(AbortSignal),
    ]);
    finish(found);
    expect(await Promise.all([first, second])).toEqual([found, found]);
    expect(await cache.probe("WORKDAY", board.boardIdentifier.toLowerCase())).toEqual(found);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
