import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { JwordError } from "../src/domain/errors";
import { createFixtureJobCollector, fixturePosting } from "../src/collection/fixtures";
import type { CollectedPosting, CollectionResult } from "../src/collection/types";
import type { LeadView } from "../src/leads/types";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const OTHER: ActorContext = { userId: "22222222-2222-4222-8222-222222222222", actorType: "USER" };
const GH = "https://job-boards.greenhouse.io/acme/jobs";

const OWNER_PREFERENCES = {
  targetLevel: "NEW_GRAD",
  employmentTarget: "FULL_TIME",
  preferredStartMonth: "2027-08",
  preferredCities: ["SAN_FRANCISCO", "NEW_YORK", "CHICAGO", "BOSTON"],
  hideRemoteOnly: true,
  preferredRoles: ["BACKEND"],
  deemphasizedRoles: ["FRONTEND"],
  maxPostingAgeDays: null,
};

async function expectError(promise: Promise<unknown>, code: string, reason?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JwordError);
  expect((error as JwordError).code).toBe(code);
  if (reason) expect((error as JwordError).details.reason).toBe(reason);
}

describe("search preferences and deterministic lead filtering", () => {
  let board: CollectionResult;
  let repo: FakeTrackerRepository;
  let services: ReturnType<typeof createTrackerServices>;
  let watchId: string;

  const complete = (postings: CollectedPosting[]): CollectionResult => ({
    status: "complete",
    reason: null,
    postings,
    reportedTotal: null,
  });
  const posting = (id: string, title: string, extra: Partial<CollectedPosting> = {}) =>
    fixturePosting(GH, id, title, { location: "New York, NY", ...extra });
  const save = (overrides: Record<string, unknown> = {}, expectedVersion?: number) =>
    services.saveSearchPreferences(
      { requestId: randomUUID(), ...OWNER_PREFERENCES, ...overrides, expectedVersion },
      OWNER,
    );
  const ids = async (view: LeadView, extra: Record<string, unknown> = {}) =>
    (await services.listLeads({ view, limit: 200, ...extra }, OWNER)).items
      .map((l) => l.postingId)
      .sort();
  const check = () => services.checkForNewJobs({ watchId }, OWNER);

  beforeEach(async () => {
    board = complete([]);
    repo = new FakeTrackerRepository();
    services = createTrackerServices({
      repository: repo,
      clock: fixedClock("2026-09-27"),
      jobCollector: createFixtureJobCollector({ GREENHOUSE: { acme: () => board } }),
    });
    ({ watchId } = await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "Acme",
        boards: [{ provider: "GREENHOUSE", boardIdentifier: "acme" }],
      },
      OWNER,
    ));
    await services.saveCandidateProfile({ graduationDate: "2027-05-15" }, OWNER);
  });

  describe("preferences", () => {
    it.each(["replay", "unchanged"])("repairs a failed re-check on an %s save", async (retry) => {
      board = complete([posting("senior", "Senior Software Engineer")]);
      await check();
      const spy = vi
        .spyOn(repo, "applyLeadEvaluations")
        .mockRejectedValueOnce(new Error("refresh unavailable"));
      const command = { requestId: randomUUID(), ...OWNER_PREFERENCES };
      expect(await services.saveSearchPreferences(command, OWNER)).toMatchObject({
        ok: true,
        reevaluationPending: true,
      });
      expect(repo.leads[0]!.match).toBe("ELIGIBLE");
      const result = await services.saveSearchPreferences(
        retry === "replay" ? command : { ...command, requestId: randomUUID(), expectedVersion: 1 },
        OWNER,
      );
      expect(result).toMatchObject({ reevaluationPending: false, reevaluated: 1 });
      expect(repo.leads[0]!).toMatchObject({ match: "EXCLUDED", version: 1, reviewStatus: "NEW" });
      expect(repo.preferenceActivities).toHaveLength(1);
      spy.mockRestore();
    });

    it("does not overwrite a newer posting when a check overlaps re-evaluation", async () => {
      board = complete([posting("a", "Software Engineer")]);
      await check();
      const read = repo.listLeadsToEvaluate.bind(repo);
      const spy = vi.spyOn(repo, "listLeadsToEvaluate").mockImplementationOnce(async (...args) => {
        const oldRows = await read(...args);
        board = complete([posting("a", "Senior Software Engineer")]);
        await check();
        return oldRows;
      });
      await save();
      expect(repo.leads[0]!).toMatchObject({
        title: "Senior Software Engineer",
        match: "EXCLUDED",
        version: 1,
        inputRevision: 2,
      });
      expect(await services.reevaluateLeads(OWNER)).toEqual({ updated: 0 });
      spy.mockRestore();
    });

    it("rejects a re-check based on an older graduation date", async () => {
      board = complete([
        posting("g", "Software Engineer", {
          description: "Candidates must be graduating between January 2027 and June 2027.",
        }),
      ]);
      await check();
      const read = repo.listLeadsToEvaluate.bind(repo);
      const spy = vi.spyOn(repo, "listLeadsToEvaluate").mockImplementationOnce(async (...args) => {
        const oldRows = await read(...args);
        await services.saveCandidateProfile({ graduationDate: "2027-12-15" }, OWNER);
        return oldRows;
      });
      expect(await save()).toMatchObject({ reevaluationPending: true });
      expect(repo.leads[0]!).toMatchObject({ match: "EXCLUDED", version: 1 });
      expect(await save({}, 1)).toMatchObject({ reevaluationPending: false });
      spy.mockRestore();
    });

    it("are empty until saved, then versioned, audited, and owner-scoped", async () => {
      expect(await services.getSearchPreferences(OWNER)).toBeNull();
      const first = await save();
      expect(first).toMatchObject({ version: 1, noop: false, summary: "Saved search preferences" });
      expect(await services.getSearchPreferences(OWNER)).toMatchObject({
        ...OWNER_PREFERENCES,
        version: 1,
      });
      expect(await services.getSearchPreferences(OTHER)).toBeNull();
      expect(repo.preferenceActivities).toHaveLength(1);

      const second = await save({ hideRemoteOnly: false }, 1);
      expect(second).toMatchObject({ version: 2, summary: "Updated search preferences" });
      expect(repo.preferenceActivities[1]).toMatchObject({
        before: expect.objectContaining({ hideRemoteOnly: true }),
        after: expect.objectContaining({ hideRemoteOnly: false }),
      });
    });

    it("reject stale versions and a second first-save", async () => {
      await save();
      await expectError(save({}, undefined), "CONFLICT", "STALE_VERSION");
      await expectError(save({ hideRemoteOnly: false }, 7), "CONFLICT", "STALE_VERSION");
    });

    it("replay a lost response and report unchanged saves as no-ops", async () => {
      const command = { requestId: randomUUID(), ...OWNER_PREFERENCES };
      const first = await services.saveSearchPreferences(command, OWNER);
      const replay = await services.saveSearchPreferences(command, OWNER);
      expect(replay).toMatchObject({ replayed: true, version: first.version });
      const same = await save({}, 1);
      expect(same).toMatchObject({ noop: true, version: 1 });
      expect(repo.preferenceActivities).toHaveLength(1);
    });

    it("validate cities, roles, months, and age limits", async () => {
      await expectError(save({ preferredCities: ["ATLANTIS"] }), "VALIDATION_ERROR");
      await expectError(save({ preferredCities: ["CHICAGO", "CHICAGO"] }), "VALIDATION_ERROR");
      await expectError(save({ deemphasizedRoles: ["BACKEND"] }), "VALIDATION_ERROR");
      await expectError(save({ preferredStartMonth: "2027-13" }), "VALIDATION_ERROR");
      await expectError(save({ maxPostingAgeDays: 0 }), "VALIDATION_ERROR");
    });
  });

  describe("collection", () => {
    it("does not store new hard-rule exclusions but keeps remote, frontend, and unclear leads", async () => {
      await save();
      board = complete([
        posting("backend", "Backend Engineer"),
        posting("frontend", "Frontend Engineer"),
        posting("remote", "Software Engineer", { location: "Remote (US)" }),
        posting("unclear", "Solutions Consultant"),
        posting("abroad", "Software Engineer", { location: "Paris, France" }),
        posting("senior", "Senior Software Engineer"),
        posting("staff", "Staff Engineer"),
        posting("intern", "Software Engineer Intern"),
        posting("sales", "Account Executive"),
      ]);
      const result = await check();
      expect(result.boards[0]).toMatchObject({
        found: 9,
        created: 5,
        filtered: 4,
        filteredReasons: { SENIORITY: 2, INTERNSHIP: 1, UNRELATED_OCCUPATION: 1 },
      });
      expect(result.totals).toMatchObject({ filtered: 4 });
      expect(repo.leads.map((l) => l.postingId).sort()).toEqual([
        "abroad",
        "backend",
        "frontend",
        "remote",
        "unclear",
      ]);
      const stored = Object.fromEntries(repo.leads.map((l) => [l.postingId, l]));
      expect(stored.frontend).toMatchObject({ match: "ELIGIBLE", roleFit: "DEEMPHASIZED" });
      expect(stored.remote).toMatchObject({ match: "ELIGIBLE", arrangement: "REMOTE" });
      expect(stored.unclear).toMatchObject({ match: "UNCERTAIN" });
      expect(stored.abroad!.evaluation!.flags).toEqual([
        expect.objectContaining({ code: "ELIGIBILITY_OUTSIDE_US", evidence: "Paris, France" }),
      ]);
    });

    it("stores everything before preferences are saved (neutral)", async () => {
      board = complete([
        posting("senior", "Senior Software Engineer"),
        posting("grad", "Software Engineer", {
          description: "Candidates must be graduating between January 2025 and December 2025.",
        }),
      ]);
      expect((await check()).totals).toMatchObject({ created: 2, filtered: 0 });
    });

    it("refreshes an existing lead that now fails, without changing review, version, or availability", async () => {
      board = complete([posting("a", "Software Engineer")]);
      await check();
      const lead = repo.leads[0]!;
      await services.setLeadReviewStatus(
        { requestId: randomUUID(), leadId: lead.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
        OWNER,
      );
      await save();
      board = complete([posting("a", "Senior Software Engineer")]);
      const result = await check();
      expect(result.totals).toMatchObject({ created: 0, updated: 1, filtered: 0 });
      expect(repo.leads[0]).toMatchObject({
        title: "Senior Software Engineer",
        match: "EXCLUDED",
        reviewStatus: "DISMISSED",
        version: 2,
        availability: "AVAILABLE",
      });
    });

    it("never lets filtering affect availability: a filtered posting is not 'closed'", async () => {
      await save();
      board = complete([posting("a", "Software Engineer"), posting("s", "Senior Engineer")]);
      await check();
      board = complete([posting("a", "Software Engineer"), posting("s", "Senior Engineer")]);
      const again = await check();
      expect(again.totals).toMatchObject({ markedUnavailable: 0, filtered: 1 });
      expect(repo.leads).toHaveLength(1);
      expect(repo.leads[0]!.availability).toBe("AVAILABLE");
    });

    it("stores structured fields for later views", async () => {
      await save();
      board = complete([
        posting("h", "Backend Engineer", {
          location: "Chicago, IL",
          locations: ["Chicago, IL", "San Francisco, CA"],
          workplaceType: "HYBRID",
          employmentType: "FULL_TIME",
        }),
      ]);
      await check();
      expect(repo.leads[0]).toMatchObject({
        locations: ["Chicago, IL", "San Francisco, CA"],
        workplaceType: "HYBRID",
        employmentType: "FULL_TIME",
        arrangement: "HYBRID",
        cityRank: 1,
      });
    });
  });

  describe("preference edits re-evaluate existing leads", () => {
    it("without deleting, dismissing, or changing versions and availability", async () => {
      board = complete([
        posting("senior", "Senior Software Engineer"),
        posting("backend", "Backend Engineer", { location: "Chicago, IL" }),
      ]);
      await check();
      expect(repo.leads.every((l) => l.match === "ELIGIBLE")).toBe(true);

      const saved = await save();
      expect(saved.reevaluated).toBe(2);
      const stored = Object.fromEntries(repo.leads.map((l) => [l.postingId, l]));
      expect(stored.senior).toMatchObject({
        match: "EXCLUDED",
        reviewStatus: "NEW",
        version: 1,
        availability: "AVAILABLE",
      });
      expect(stored.backend).toMatchObject({ match: "ELIGIBLE", cityRank: 3 });
      expect(await ids("RECOMMENDED")).toEqual(["backend"]);
      expect(await ids("FILTERED")).toEqual(["senior"]);

      // Loosening brings it back; nothing was lost.
      const loosened = await save({ targetLevel: "ANY" }, 1);
      expect(loosened.reevaluated).toBe(2);
      expect(await ids("RECOMMENDED")).toEqual(["backend", "senior"]);
    });

    it("previously skipped postings enter only on the next check", async () => {
      await save();
      board = complete([posting("senior", "Senior Software Engineer")]);
      await check();
      expect(repo.leads).toHaveLength(0);
      await save({ targetLevel: "ANY" }, 1);
      expect(repo.leads).toHaveLength(0);
      await check();
      expect(repo.leads.map((l) => l.postingId)).toEqual(["senior"]);
    });

    it("a graduation date change re-evaluates the graduation rule", async () => {
      await save();
      board = complete([
        posting("g", "Software Engineer", {
          description: "Candidates must be graduating between December 2026 and June 2027.",
        }),
      ]);
      await check();
      expect(repo.leads[0]!.match).toBe("ELIGIBLE");
      await services.saveCandidateProfile({ graduationDate: "2027-12-15" }, OWNER);
      expect(repo.leads[0]!.match).toBe("EXCLUDED");
    });

    it("a stale re-evaluation never overwrites a newer preferences version", async () => {
      await save();
      await expectError(
        repo.applyLeadEvaluations({ actor: OWNER, today: null }, 0, [], "2027-05-15"),
        "CONFLICT",
        "STALE_PREFERENCES",
      );
    });

    it("a check re-evaluates leads saved under an older snapshot", async () => {
      board = complete([posting("senior", "Senior Software Engineer")]);
      await check(); // neutral snapshot: stored as eligible
      // Simulate a preferences save whose own re-evaluation did not run.
      await repo.saveSearchPreferences({ actor: OWNER, today: null }, {
        requestId: randomUUID(),
        ...OWNER_PREFERENCES,
      } as never);
      expect(repo.leads[0]!.match).toBe("ELIGIBLE");
      board = complete([]);
      const result = await check();
      expect(result.reevaluated).toBe(1);
      expect(repo.leads[0]!.match).toBe("EXCLUDED");
    });
  });

  describe("views", () => {
    beforeEach(async () => {
      await save({ maxPostingAgeDays: 30 });
      board = complete([
        posting("nyc", "Backend Engineer", { postedOn: "2026-09-20" }),
        posting("sf", "Software Engineer", { location: "San Francisco, CA", postedOn: null }),
        posting("old", "Software Engineer", { location: "Boston, MA", postedOn: "2026-06-01" }),
        posting("remote", "Software Engineer", { location: "Remote (US)" }),
        posting("fe", "Frontend Engineer", { location: "Denver, CO" }),
      ]);
      await check();
      // An existing lead that preferences now exclude.
      board = complete([]);
    });

    it("recommended hides remote-only, filtered-out, and stale-dated leads but keeps undated ones", async () => {
      expect(await ids("RECOMMENDED")).toEqual(["fe", "nyc", "sf"]);
    });

    it("remote only, all, and filtered out", async () => {
      expect(await ids("REMOTE")).toEqual(["remote"]);
      expect(await ids("ALL")).toEqual(["fe", "nyc", "old", "remote", "sf"]);
      expect(await ids("FILTERED")).toEqual([]);
    });

    it("shows remote leads in recommended when the owner does not hide them", async () => {
      await save({ maxPostingAgeDays: 30, hideRemoteOnly: false }, 1);
      expect(await ids("RECOMMENDED")).toEqual(["fe", "nyc", "remote", "sf"]);
    });

    it("sorts by preferred city without dropping unranked leads, and filters roles", async () => {
      const byCity = await services.listLeads({ view: "ALL", sort: "CITY", limit: 200 }, OWNER);
      expect(byCity.items.map((l) => l.postingId).slice(0, 3)).toEqual(["sf", "nyc", "old"]);
      expect(byCity.items).toHaveLength(5);
      expect(await ids("ALL", { role: "PREFERRED" })).toEqual(["nyc"]);
      expect(await ids("ALL", { role: "NOT_DEEMPHASIZED" })).toEqual([
        "nyc",
        "old",
        "remote",
        "sf",
      ]);
    });
  });
});
