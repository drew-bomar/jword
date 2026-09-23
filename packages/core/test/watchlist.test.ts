import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { JwordError } from "../src/domain/errors";
import { createTrackerServices, type TrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";
import {
  addWatchedCompanySchema,
  boardInputSchema,
  setCompanyWatchStatusSchema,
  updateWatchedCompanySchema,
} from "../src/watchlist/schemas";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const OTHER: ActorContext = { userId: "22222222-2222-4222-8222-222222222222", actorType: "USER" };
const CODEX: ActorContext = { ...OWNER, actorType: "CODEX" };

let repo: FakeTrackerRepository;
let services: TrackerServices;

beforeEach(() => {
  repo = new FakeTrackerRepository();
  services = createTrackerServices({ repository: repo, clock: fixedClock("2026-09-22") });
});

async function expectError(promise: Promise<unknown>, code: string, reason?: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JwordError);
    const typed = error as JwordError;
    expect(typed.code).toBe(code);
    if (reason) expect(typed.reason).toBe(reason);
    return typed;
  }
  throw new Error(`expected ${code}`);
}

/** Shorthand: provider/boardIdentifier/boardUrl become a one-board list (OTHER without URL: none). */
function add(overrides: Record<string, unknown> = {}, actor = OWNER) {
  const { provider = "GREENHOUSE", boardIdentifier = "stripe", boardUrl, ...rest } = overrides;
  const boards =
    provider === "OTHER"
      ? boardUrl
        ? [{ provider, boardUrl }]
        : []
      : [{ provider, boardIdentifier }];
  return services.addWatchedCompany(
    { requestId: randomUUID(), company: "Stripe", boards, ...rest },
    actor,
  );
}

describe("watchlist schemas", () => {
  const base = { requestId: randomUUID(), company: "Stripe" };
  const ok = (value: unknown) => addWatchedCompanySchema.safeParse(value).success;
  const board = (value: unknown) => boardInputSchema.safeParse(value).success;

  it("requires a company name or id; boards are optional", () => {
    expect(ok({ requestId: randomUUID() })).toBe(false);
    expect(ok({ requestId: randomUUID(), companyId: randomUUID() })).toBe(true);
    expect(ok(base)).toBe(true);
  });

  it("each board needs an identifier (supported) or a careers URL (OTHER)", () => {
    expect(board({ provider: "LEVER" })).toBe(false);
    expect(board({ provider: "LEVER", boardIdentifier: "  " })).toBe(false);
    expect(board({ provider: "LEVER", boardIdentifier: "stripe" })).toBe(true);
    expect(board({ provider: "OTHER", boardIdentifier: "stripe", boardUrl: "https://x.co" })).toBe(
      false,
    );
    expect(board({ provider: "OTHER" })).toBe(false);
    expect(board({ provider: "OTHER", boardUrl: "https://stripe.com/jobs" })).toBe(true);
    expect(board({ provider: "ASHBY", boardIdentifier: "has space" })).toBe(false);
    expect(
      board({ provider: "ASHBY", boardIdentifier: "x", boardUrl: "https://jobs.ashbyhq.com/x" }),
    ).toBe(false);
    expect(board({ provider: "WORKDAY", boardIdentifier: "x" })).toBe(false);
  });

  it("allows at most three boards and no duplicates (any case)", () => {
    const b = (id: string) => ({ provider: "ASHBY", boardIdentifier: id });
    expect(ok({ ...base, boards: [b("a"), b("b"), b("c")] })).toBe(true);
    expect(ok({ ...base, boards: [b("a"), b("b"), b("c"), b("d")] })).toBe(false);
    expect(ok({ ...base, boards: [b("a"), b("A")] })).toBe(false);
    expect(ok({ ...base, boards: [b("a"), { provider: "LEVER", boardIdentifier: "a" }] })).toBe(
      true,
    );
  });

  it("rejects bad company fields and unknown keys", () => {
    expect(ok({ ...base, interestLevel: 6 })).toBe(false);
    expect(ok({ ...base, interestLevel: 2.5 })).toBe(false);
    expect(ok({ ...base, websiteUrl: "stripe.com" })).toBe(false);
    expect(ok({ ...base, active: false })).toBe(false);
    expect(ok({ ...base, provider: "GREENHOUSE" })).toBe(false);
  });

  it("update needs at least one editable field and its own ids", () => {
    const ids = { requestId: randomUUID(), watchId: randomUUID(), expectedVersion: 1 };
    expect(updateWatchedCompanySchema.safeParse(ids).success).toBe(false);
    expect(updateWatchedCompanySchema.safeParse({ ...ids, interestLevel: null }).success).toBe(
      true,
    );
    expect(updateWatchedCompanySchema.safeParse({ ...ids, boards: [] }).success).toBe(true);
    expect(updateWatchedCompanySchema.safeParse({ ...ids, active: true }).success).toBe(false);
    expect(updateWatchedCompanySchema.safeParse({ ...ids, company: "Renamed" }).success).toBe(
      false,
    );
    expect(
      updateWatchedCompanySchema.safeParse({ ...ids, interestLevel: 3, expectedVersion: 0 })
        .success,
    ).toBe(false);
  });

  it("status change needs a boolean", () => {
    const ids = { requestId: randomUUID(), watchId: randomUUID(), expectedVersion: 1 };
    expect(setCompanyWatchStatusSchema.safeParse({ ...ids, active: false }).success).toBe(true);
    expect(setCompanyWatchStatusSchema.safeParse({ ...ids, active: "no" }).success).toBe(false);
  });
});

describe("watchlist services", () => {
  it("adds a new company with a derived board URL and an audit row", async () => {
    const result = await add({ interestLevel: 4, companyNotes: "payments infra" });
    expect(result).toMatchObject({
      ok: true,
      noop: false,
      replayed: false,
      company: "Stripe",
      companyCreated: true,
      active: true,
      version: 1,
    });
    expect(result.after).toMatchObject({ boards: "Greenhouse stripe", interestLevel: 4 });
    const view = await services.getWatchedCompany({ watchId: result.watchId }, OWNER);
    expect(view.watch.boards).toEqual([
      {
        provider: "GREENHOUSE",
        boardIdentifier: "stripe",
        boardUrl: "https://job-boards.greenhouse.io/stripe",
      },
    ]);
    expect(result.changedFields).toContain("companyNotes");
    expect(JSON.stringify(result)).not.toContain("payments infra");
    expect(repo.watchActivities).toHaveLength(1);
    expect(repo.watchActivities[0]).toMatchObject({ type: "WATCH_CREATED", actorType: "USER" });
    expect(repo.companies[0]).toMatchObject({ interestLevel: 4, notes: "payments infra" });
  });

  it("reuses an existing company by exact name match or explicit id, and creates no applications", async () => {
    const app = await services.createApplication(
      { requestId: randomUUID(), company: "Datadog", title: "SWE" },
      OWNER,
    );
    const byName = await add({ company: "  datadog ", boardIdentifier: "datadog" });
    expect(byName).toMatchObject({ companyId: app.companyId, companyCreated: false });
    expect(repo.companies).toHaveLength(1);
    expect(repo.applications).toHaveLength(1);
    expect(repo.jobs).toHaveLength(1);

    await services.createApplication(
      { requestId: randomUUID(), company: "Acme Inc.", title: "SWE" },
      OWNER,
    );
    const acme = repo.companies.find((c) => c.name === "Acme Inc.")!;
    const byId = await add({
      company: undefined,
      companyId: acme.id,
      provider: "OTHER",
      boardIdentifier: undefined,
    });
    expect(byId).toMatchObject({ companyId: acme.id, company: "Acme Inc." });
    const view = await services.getWatchedCompany({ watchId: byId.watchId }, OWNER);
    expect(view.watch.applicationCount).toBe(1);
  });

  it("does not treat a different spelling as the same company (decision 013)", async () => {
    await add({ company: "Acme", provider: "OTHER", boardIdentifier: undefined });
    const second = await add({
      company: "Acme Inc.",
      provider: "OTHER",
      boardIdentifier: undefined,
    });
    expect(second.companyCreated).toBe(true);
    expect(repo.companies).toHaveLength(2);
  });

  it("rejects a company id that belongs to another owner", async () => {
    const theirs = await add({}, OTHER);
    await expectError(
      add({ company: undefined, companyId: theirs.companyId, boardIdentifier: "x" }),
      "NOT_FOUND",
      "COMPANY_NOT_FOUND",
    );
    expect(repo.watches.filter((w) => w.userId === OWNER.userId)).toHaveLength(0);
  });

  it("returns CONFLICT/ALREADY_WATCHED with the existing id, including inactive watches", async () => {
    const first = await add();
    const dup = await expectError(add({ company: "STRIPE" }), "CONFLICT", "ALREADY_WATCHED");
    expect(dup.details).toMatchObject({
      watchId: first.watchId,
      watchActive: true,
      currentVersion: 1,
    });

    await services.setCompanyWatchStatus(
      { requestId: randomUUID(), watchId: first.watchId, expectedVersion: 1, active: false },
      OWNER,
    );
    const inactive = await expectError(add(), "CONFLICT", "ALREADY_WATCHED");
    expect(inactive.details).toMatchObject({
      watchId: first.watchId,
      watchActive: false,
      currentVersion: 2,
    });
    expect(repo.watches).toHaveLength(1);
    expect(repo.watchActivities).toHaveLength(2);
  });

  it("rejects the same board under a second company name", async () => {
    await add();
    const clash = await expectError(
      add({ company: "Stripe Payments", boardIdentifier: "STRIPE" }),
      "CONFLICT",
      "BOARD_ALREADY_WATCHED",
    );
    expect(clash.details.company).toBe("Stripe");
    // The rolled-back save left no new company behind.
    expect(repo.companies.map((c) => c.name)).toEqual(["Stripe"]);
  });

  it("replaces the board set, bumps the version, and records changed fields", async () => {
    const created = await add();
    const updated = await services.updateWatchedCompany(
      {
        requestId: randomUUID(),
        watchId: created.watchId,
        expectedVersion: 1,
        boards: [
          { provider: "GREENHOUSE", boardIdentifier: "stripe" },
          { provider: "LEVER", boardIdentifier: "stripe" },
          { provider: "OTHER", boardUrl: "https://stripe.com/jobs" },
        ],
        interestLevel: 5,
        websiteUrl: "https://stripe.com",
      },
      OWNER,
    );
    expect(updated).toMatchObject({ noop: false, version: 2 });
    expect(updated.changedFields).toEqual(["boards", "interestLevel", "websiteUrl"]);
    expect(updated.after.boards).toBe("Greenhouse stripe, Lever stripe, careers page");
    const view = await services.getWatchedCompany({ watchId: created.watchId }, OWNER);
    expect(view.watch.boards.map((b) => b.boardUrl)).toEqual([
      "https://job-boards.greenhouse.io/stripe",
      "https://jobs.lever.co/stripe",
      "https://stripe.com/jobs",
    ]);
    expect(view.activity.items[0]).toMatchObject({ type: "WATCH_UPDATED" });

    const cleared = await services.updateWatchedCompany(
      { requestId: randomUUID(), watchId: created.watchId, expectedVersion: 2, boards: [] },
      OWNER,
    );
    expect(cleared.after.boards).toBe("no job board");
  });

  it("rejects a fourth board, duplicates, and an OTHER board without a URL", async () => {
    const b = (id: string) => ({ provider: "ASHBY" as const, boardIdentifier: id });
    await expectError(
      services.addWatchedCompany(
        { requestId: randomUUID(), company: "Four", boards: [b("a"), b("b"), b("c"), b("d")] },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
    await expectError(
      services.addWatchedCompany(
        { requestId: randomUUID(), company: "Dup", boards: [b("x"), b("X")] },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
    expect(repo.watches).toHaveLength(0);
  });

  it("identical values are a no-op with a receipt and no audit row", async () => {
    const created = await add({ interestLevel: 3 });
    const requestId = randomUUID();
    const command = { requestId, watchId: created.watchId, expectedVersion: 1, interestLevel: 3 };
    const noop = await services.updateWatchedCompany(command, OWNER);
    expect(noop).toMatchObject({ noop: true, version: 1, activityId: null });
    expect(repo.watchActivities).toHaveLength(1);
    expect(await services.updateWatchedCompany(command, OWNER)).toMatchObject({ replayed: true });
  });

  it("stale expectedVersion is a CONFLICT and changes nothing", async () => {
    const created = await add();
    await services.updateWatchedCompany(
      { requestId: randomUUID(), watchId: created.watchId, expectedVersion: 1, interestLevel: 2 },
      OWNER,
    );
    const stale = await expectError(
      services.setCompanyWatchStatus(
        { requestId: randomUUID(), watchId: created.watchId, expectedVersion: 1, active: false },
        OWNER,
      ),
      "CONFLICT",
      "STALE_VERSION",
    );
    expect(stale.details.currentVersion).toBe(2);
    expect(repo.watches[0]!.active).toBe(true);
  });

  it("deactivate and reactivate touch only the watch", async () => {
    const app = await services.createApplication(
      { requestId: randomUUID(), company: "Stripe", title: "SWE" },
      OWNER,
    );
    const created = await add();
    const before = structuredClone({
      companies: repo.companies,
      applications: repo.applications,
      activities: repo.activities,
    });
    const off = await services.setCompanyWatchStatus(
      { requestId: randomUUID(), watchId: created.watchId, expectedVersion: 1, active: false },
      OWNER,
    );
    expect(off).toMatchObject({ active: false, version: 2, summary: "Stopped watching Stripe" });
    const on = await services.setCompanyWatchStatus(
      { requestId: randomUUID(), watchId: created.watchId, expectedVersion: 2, active: true },
      CODEX,
    );
    expect(on).toMatchObject({ active: true, version: 3 });
    expect({
      companies: repo.companies,
      applications: repo.applications,
      activities: repo.activities,
    }).toEqual(before);
    expect(repo.applications[0]!.id).toBe(app.applicationId);
    expect(repo.watchActivities.map((a) => [a.type, a.actorType])).toEqual([
      ["WATCH_CREATED", "USER"],
      ["WATCH_DEACTIVATED", "USER"],
      ["WATCH_ACTIVATED", "CODEX"],
    ]);
  });

  it("a retry with the same request id replays; a changed command under it is rejected", async () => {
    const requestId = randomUUID();
    const first = await add({ requestId });
    const replay = await add({ requestId });
    expect(replay).toMatchObject({ replayed: true, watchId: first.watchId });
    expect(repo.watches).toHaveLength(1);
    await expectError(add({ requestId, interestLevel: 2 }), "CONFLICT", "REQUEST_ID_REUSED");
  });

  it("an audit failure rolls back the watch and the company it created", async () => {
    repo.failBeforeActivity = true;
    await expectError(add(), "INTERNAL_ERROR");
    expect(repo.watches).toHaveLength(0);
    expect(repo.companies).toHaveLength(0);
    expect(repo.receipts.size).toBe(0);
  });

  it("scopes reads to the owner and filters by text, active state, and provider", async () => {
    await add();
    await add({ company: "Netflix", provider: "LEVER", boardIdentifier: "netflix" });
    const hidden = await add({ company: "Ramp", provider: "ASHBY", boardIdentifier: "ramp" });
    await services.setCompanyWatchStatus(
      { requestId: randomUUID(), watchId: hidden.watchId, expectedVersion: 1, active: false },
      OWNER,
    );
    await add({ company: "Theirs", boardIdentifier: "theirs" }, OTHER);

    const names = async (input: Record<string, unknown>) =>
      (await services.listWatchedCompanies(input, OWNER)).items.map((w) => w.company);
    expect(await names({})).toEqual(["Netflix", "Ramp", "Stripe"]);
    expect(await names({ active: true })).toEqual(["Netflix", "Stripe"]);
    expect(await names({ active: false })).toEqual(["Ramp"]);
    expect(await names({ provider: "LEVER" })).toEqual(["Netflix"]);
    expect(await names({ text: "str" })).toEqual(["Stripe"]);
    await expectError(services.getWatchedCompany({ watchId: hidden.watchId }, OTHER), "NOT_FOUND");

    const page = await services.listWatchedCompanies({ limit: 2 }, OWNER);
    expect(page).toMatchObject({ hasMore: true });
    const next = await services.listWatchedCompanies({ limit: 2, cursor: page.nextCursor }, OWNER);
    expect(next.items.map((w) => w.company)).toEqual(["Stripe"]);
    await expectError(
      services.listWatchedCompanies({ limit: 2, cursor: page.nextCursor, active: true }, OWNER),
      "VALIDATION_ERROR",
    );
  });

  it("company search offers existing companies with their watch state", async () => {
    await services.createApplication(
      { requestId: randomUUID(), company: "Acme", title: "SWE" },
      OWNER,
    );
    const watched = await add({
      company: "Acme Robotics",
      provider: "OTHER",
      boardIdentifier: undefined,
    });
    const options = await services.searchCompanies({ text: "acme" }, OWNER);
    expect(options).toEqual([
      expect.objectContaining({ name: "Acme", watchId: null, watchActive: null }),
      expect.objectContaining({
        name: "Acme Robotics",
        watchId: watched.watchId,
        watchActive: true,
      }),
    ]);
    expect(await services.searchCompanies({ text: "acme" }, OTHER)).toEqual([]);
  });
});
