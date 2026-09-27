import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { JwordError } from "../src/domain/errors";
import { createFixtureJobCollector, fixturePosting } from "../src/collection/fixtures";
import type { CollectedPosting, CollectionResult } from "../src/collection/types";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const OTHER: ActorContext = { userId: "22222222-2222-4222-8222-222222222222", actorType: "USER" };
const GH = "https://job-boards.greenhouse.io/acme/jobs";

async function expectError(promise: Promise<unknown>, code: string, reason?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JwordError);
  expect((error as JwordError).code).toBe(code);
  if (reason) expect((error as JwordError).details.reason).toBe(reason);
}

describe("check for new jobs", () => {
  let greenhouse: CollectionResult;
  let lever: CollectionResult;
  let repo: FakeTrackerRepository;
  let services: ReturnType<typeof createTrackerServices>;
  let collector: ReturnType<typeof createFixtureJobCollector>;

  const complete = (postings: CollectedPosting[]): CollectionResult => ({
    status: "complete",
    reason: null,
    postings,
    reportedTotal: null,
  });
  const posting = (id: string, title = `Role ${id}`, extra: Partial<CollectedPosting> = {}) =>
    fixturePosting(GH, id, title, extra);

  async function watchAcme(
    boards: unknown[] = [{ provider: "GREENHOUSE", boardIdentifier: "acme" }],
  ) {
    return services.addWatchedCompany({ requestId: randomUUID(), company: "Acme", boards }, OWNER);
  }
  const leads = async (actor = OWNER) =>
    (await services.listLeads({ limit: 200 }, actor)).items.sort((a, b) =>
      a.postingId.localeCompare(b.postingId),
    );

  beforeEach(() => {
    greenhouse = complete([posting("1"), posting("2")]);
    lever = complete([]);
    collector = createFixtureJobCollector({
      GREENHOUSE: { acme: () => greenhouse },
      LEVER: { acme: () => lever },
    });
    repo = new FakeTrackerRepository();
    services = createTrackerServices({
      repository: repo,
      clock: fixedClock("2026-09-25"),
      jobCollector: collector,
    });
  });

  it("saves new postings as leads and never creates applications", async () => {
    const watch = await watchAcme();
    const result = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(result.boards).toEqual([
      expect.objectContaining({
        company: "Acme",
        provider: "GREENHOUSE",
        status: "complete",
        found: 2,
        created: 2,
        updated: 0,
        markedUnavailable: 0,
      }),
    ]);
    expect(result.totals).toMatchObject({ boards: 1, complete: 1, created: 2 });
    expect((await leads()).map((l) => [l.postingId, l.reviewStatus, l.availability])).toEqual([
      ["1", "NEW", "AVAILABLE"],
      ["2", "NEW", "AVAILABLE"],
    ]);
    expect(repo.applications).toHaveLength(0);
  });

  it("repeat scans update in place without duplicates or resetting review decisions", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    const [first] = await leads();
    await services.setLeadReviewStatus(
      {
        requestId: randomUUID(),
        leadId: first!.leadId,
        expectedVersion: 1,
        reviewStatus: "DISMISSED",
      },
      OWNER,
    );
    greenhouse = complete([posting("1", "Role 1 (renamed)"), posting("2")]);
    const again = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(again.totals).toMatchObject({ created: 0, updated: 1, found: 2 });
    const after = await leads();
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({
      title: "Role 1 (renamed)",
      reviewStatus: "DISMISSED",
      version: 2,
    });
  });

  it("only a complete scan marks unseen postings unavailable; relisted postings come back", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);

    greenhouse = {
      status: "partial",
      reason: "PAGE_FAILED",
      postings: [posting("1")],
      reportedTotal: null,
    };
    const partial = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(partial.boards[0]).toMatchObject({
      status: "partial",
      reason: "PAGE_FAILED",
      markedUnavailable: 0,
    });
    greenhouse = { status: "failed", reason: "PROVIDER_ERROR", postings: [], reportedTotal: null };
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    greenhouse = {
      status: "partial",
      reason: "TOTAL_CAPPED",
      postings: [posting("1")],
      reportedTotal: 2000,
    };
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect((await leads()).map((l) => l.availability)).toEqual(["AVAILABLE", "AVAILABLE"]);

    greenhouse = complete([posting("1")]);
    const done = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(done.boards[0]).toMatchObject({ status: "complete", markedUnavailable: 1 });
    const [, gone] = await leads();
    expect(gone).toMatchObject({
      postingId: "2",
      availability: "UNAVAILABLE",
      reviewStatus: "NEW",
    });
    expect(gone!.unavailableAt).not.toBeNull();

    greenhouse = complete([posting("1"), posting("2")]);
    const back = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(back.totals).toMatchObject({ relisted: 1, markedUnavailable: 0 });
    expect((await leads())[1]).toMatchObject({ availability: "AVAILABLE", unavailableAt: null });
  });

  it("keeps a stated posting date and never invents one", async () => {
    const watch = await watchAcme();
    greenhouse = complete([posting("1", "Role", { postedOn: "2026-09-20" }), posting("2")]);
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    greenhouse = complete([posting("1", "Role", { postedOn: null }), posting("2")]);
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect((await leads()).map((l) => l.postedOn)).toEqual(["2026-09-20", null]);
  });

  it("reports careers pages as unsupported and keeps checking after a failed board", async () => {
    const watch = await watchAcme([
      { provider: "LEVER", boardIdentifier: "missing" },
      { provider: "GREENHOUSE", boardIdentifier: "acme" },
      { provider: "OTHER", boardUrl: "https://acme.example/careers" },
    ]);
    const result = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(result.boards.map((b) => [b.provider, b.status, b.reason])).toEqual([
      ["LEVER", "failed", "BOARD_NOT_FOUND"],
      ["GREENHOUSE", "complete", null],
      ["OTHER", "unsupported", "UNSUPPORTED_BOARD"],
    ]);
    expect(result.totals).toMatchObject({
      boards: 3,
      complete: 1,
      failed: 1,
      unsupported: 1,
      created: 2,
    });
    expect(collector.calls.some((c) => c.identifier.includes("careers"))).toBe(false);
  });

  it.each([false, true])(
    "isolates an unconfirmed finish even if it committed (%s)",
    async (committed) => {
      const watch = await watchAcme([
        { provider: "GREENHOUSE", boardIdentifier: "acme" },
        { provider: "LEVER", boardIdentifier: "acme" },
      ]);
      const finish = repo.finishLeadScan.bind(repo);
      vi.spyOn(repo, "finishLeadScan").mockImplementation(async (ctx, scan) => {
        const source = repo.leadScans.find((s) => s.id === scan.scanId);
        // Fail the scan that saved postings; the empty board must still complete.
        if (source && repo.leads.some((l) => l.sourceId === source.sourceId)) {
          if (committed) await finish(ctx, scan);
          throw new JwordError("INTERNAL_ERROR", "lost finish response");
        }
        return finish(ctx, scan);
      });
      const result = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
      expect(result.boards[0]).toMatchObject({ status: "failed", reason: "FINISH_UNCONFIRMED" });
      expect(result.boards[1]).toMatchObject({ status: "complete" });
      expect(await leads()).toHaveLength(2);
    },
  );

  it("never finishes COMPLETE when recording postings fails", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    greenhouse = complete([posting("1")]);
    vi.spyOn(repo, "recordLeadPostings").mockRejectedValueOnce(new Error("chunk failed"));
    const result = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(result.boards[0]).toMatchObject({
      status: "partial",
      reason: "SAVE_FAILED",
      markedUnavailable: 0,
    });
    expect((await leads()).map((l) => l.availability)).toEqual(["AVAILABLE", "AVAILABLE"]);
  });

  it("propagates authorization failures when finishing a scan", async () => {
    const watch = await watchAcme();
    vi.spyOn(repo, "finishLeadScan").mockRejectedValueOnce(new JwordError("FORBIDDEN", "denied"));
    await expectError(services.checkForNewJobs({ watchId: watch.watchId }, OWNER), "FORBIDDEN");
  });

  it("stops starting more boards after an authorization failure", async () => {
    await watchAcme();
    for (const name of ["second", "third", "fourth"]) {
      await services.addWatchedCompany(
        {
          requestId: randomUUID(),
          company: name,
          boards: [{ provider: "GREENHOUSE", boardIdentifier: name }],
        },
        OWNER,
      );
    }
    const begin = vi
      .spyOn(repo, "beginLeadScan")
      .mockRejectedValueOnce(new JwordError("FORBIDDEN", "denied"));
    await expectError(services.checkForNewJobs({}, OWNER), "FORBIDDEN");
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it("checks every active watch, skipping inactive ones", async () => {
    await watchAcme();
    const paused = await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "Paused",
        boards: [{ provider: "LEVER", boardIdentifier: "acme" }],
      },
      OWNER,
    );
    await services.setCompanyWatchStatus(
      { requestId: randomUUID(), watchId: paused.watchId, expectedVersion: 1, active: false },
      OWNER,
    );
    const result = await services.checkForNewJobs({}, OWNER);
    expect(result.watchId).toBeNull();
    expect(result.boards.map((b) => b.company)).toEqual(["Acme"]);
  });

  it("retains leads when the watch is deleted and reuses the source when re-added", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    await services.deleteWatchedCompany(
      { requestId: randomUUID(), watchId: watch.watchId, expectedVersion: 1, confirmed: true },
      OWNER,
    );
    const kept = await leads();
    expect(kept).toHaveLength(2);

    const again = await watchAcme([{ provider: "GREENHOUSE", boardIdentifier: "ACME" }]);
    const result = await services.checkForNewJobs({ watchId: again.watchId }, OWNER);
    expect(result.totals).toMatchObject({ created: 0, found: 2 });
    const after = await leads();
    expect(after.map((l) => l.leadId)).toEqual(kept.map((l) => l.leadId));
    expect(repo.leadSources).toHaveLength(1);
  });

  it("allows one running scan per board and recovers from an interrupted one", async () => {
    const watch = await watchAcme();
    const ctx = { actor: OWNER, today: null };
    const board = {
      watchId: watch.watchId,
      provider: "GREENHOUSE" as const,
      boardIdentifier: "acme",
    };
    await repo.beginLeadScan(ctx, board);
    const blocked = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(blocked.boards[0]).toMatchObject({ status: "failed", reason: "IN_PROGRESS" });
    repo.advanceClock(6 * 60_000);
    const resumed = await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect(resumed.boards[0]).toMatchObject({ status: "complete", created: 2 });
    expect(repo.leadScans.map((s) => [s.status, s.reason])).toContainEqual([
      "FAILED",
      "INTERRUPTED",
    ]);
  });

  it("scopes leads and review changes to their owner", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    const [lead] = await leads();
    expect(await leads(OTHER)).toEqual([]);
    await expectError(services.getLead({ leadId: lead!.leadId }, OTHER), "NOT_FOUND");
    await expectError(
      services.setLeadReviewStatus(
        {
          requestId: randomUUID(),
          leadId: lead!.leadId,
          expectedVersion: 1,
          reviewStatus: "DISMISSED",
        },
        OTHER,
      ),
      "NOT_FOUND",
    );
    await expectError(services.checkForNewJobs({ watchId: watch.watchId }, OTHER), "NOT_FOUND");
  });

  it("dismisses and restores with versions, no-ops, and stale-version conflicts", async () => {
    const watch = await watchAcme();
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    const [lead] = await leads();
    const command = {
      requestId: randomUUID(),
      leadId: lead!.leadId,
      expectedVersion: 1,
      reviewStatus: "DISMISSED",
    };
    const dismissed = await services.setLeadReviewStatus(command, OWNER);
    expect(dismissed).toMatchObject({ reviewStatus: "DISMISSED", version: 2, noop: false });
    expect(await services.setLeadReviewStatus(command, OWNER)).toMatchObject({ replayed: true });
    await expectError(
      services.setLeadReviewStatus({ ...command, requestId: randomUUID() }, OWNER),
      "CONFLICT",
      "STALE_VERSION",
    );
    const same = await services.setLeadReviewStatus(
      { ...command, requestId: randomUUID(), expectedVersion: 2 },
      OWNER,
    );
    expect(same).toMatchObject({ noop: true, version: 2 });
    const restored = await services.setLeadReviewStatus(
      { ...command, requestId: randomUUID(), expectedVersion: 2, reviewStatus: "NEW" },
      OWNER,
    );
    expect(restored).toMatchObject({ reviewStatus: "NEW", version: 3 });
    expect(repo.leadActivities.map((a) => a.type)).toEqual(["LEAD_DISMISSED", "LEAD_RESTORED"]);
  });

  it("creates one linked application per lead, safely retried, with duplicate checks", async () => {
    const watch = await watchAcme();
    greenhouse = complete([
      posting("1", "Backend Engineer", { location: "Remote", postedOn: "2026-09-20" }),
      posting("2", "Frontend Engineer"),
    ]);
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    const [backend, frontend] = await leads();
    const command = { requestId: randomUUID(), leadId: backend!.leadId, expectedVersion: 1 };
    const created = await services.createApplicationFromLead(command, OWNER);
    expect(created).toMatchObject({ reviewStatus: "PROMOTED", version: 2 });
    const app = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(app.application).toMatchObject({
      company: "Acme",
      title: "Backend Engineer",
      status: "SAVED",
      jobUrl: `${GH}/1`,
      externalJobId: "1",
      location: "Remote",
      datePosted: "2026-09-20",
      dateFound: "2026-09-25",
      source: "Greenhouse",
    });

    // A lost response retried with the same request id returns the same application.
    expect(await services.createApplicationFromLead(command, OWNER)).toMatchObject({
      replayed: true,
      applicationId: created.applicationId,
    });
    expect(repo.applications).toHaveLength(1);
    await expectError(
      services.createApplicationFromLead(
        { ...command, requestId: randomUUID(), expectedVersion: 2 },
        OWNER,
      ),
      "CONFLICT",
      "LEAD_PROMOTED",
    );
    await expectError(
      services.setLeadReviewStatus(
        {
          requestId: randomUUID(),
          leadId: backend!.leadId,
          expectedVersion: 2,
          reviewStatus: "DISMISSED",
        },
        OWNER,
      ),
      "CONFLICT",
      "LEAD_PROMOTED",
    );

    // A similar existing application needs explicit confirmation.
    await services.createApplication(
      { requestId: randomUUID(), company: "Acme", title: "Frontend Engineer" },
      OWNER,
    );
    const second = { requestId: randomUUID(), leadId: frontend!.leadId, expectedVersion: 1 };
    await expectError(
      services.createApplicationFromLead(second, OWNER),
      "CONFLICT",
      "DUPLICATE_CANDIDATES",
    );
    expect((await leads())[1]).toMatchObject({ reviewStatus: "NEW", version: 1 });
    const confirmed = await services.createApplicationFromLead(
      { ...second, allowDuplicate: true },
      OWNER,
    );
    expect(confirmed.reviewStatus).toBe("PROMOTED");

    // Promoted status survives later scans.
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    expect((await leads()).map((l) => l.reviewStatus)).toEqual(["PROMOTED", "PROMOTED"]);
  });

  it("fails clearly when no collector is configured", async () => {
    const bare = createTrackerServices({ repository: repo, clock: fixedClock("2026-09-25") });
    await expectError(bare.checkForNewJobs({}, OWNER), "INTERNAL_ERROR");
  });
});
