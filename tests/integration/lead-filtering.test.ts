import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  createFixtureJobCollector,
  createTrackerServices,
  fixedClock,
  fixturePosting,
  evaluatePosting,
  evaluationKey,
  toStoredEvaluation,
  NEUTRAL_PREFERENCES,
  SupabaseTrackerRepository,
  type CollectedPosting,
  type CollectionResult,
  type Json,
} from "@jword/core";
import {
  anonClient,
  cleanupUsers,
  closePg,
  createTestUser,
  expectJwordError,
  pgQuery,
  rid,
  TODAY,
  type TestUser,
} from "./helpers";

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});

const GH = "https://job-boards.greenhouse.io/acme-filter/jobs";
const posting = (id: string, title: string, extra: Partial<CollectedPosting> = {}) =>
  fixturePosting(GH, id, title, { location: "New York, NY", ...extra });
const complete = (postings: CollectedPosting[]): CollectionResult => ({
  status: "complete",
  reason: null,
  postings,
  reportedTotal: null,
});

const PREFERENCES = {
  targetLevel: "NEW_GRAD",
  employmentTarget: "FULL_TIME",
  preferredStartMonth: "2027-08",
  preferredCities: ["SAN_FRANCISCO", "NEW_YORK", "CHICAGO", "BOSTON"],
  hideRemoteOnly: true,
  preferredRoles: ["BACKEND"],
  deemphasizedRoles: ["FRONTEND"],
  maxPostingAgeDays: null,
};

let board: CollectionResult;
const collector = createFixtureJobCollector({ GREENHOUSE: { "acme-filter": () => board } });

async function setup(label: string) {
  const owner: TestUser = await createTestUser(label);
  const repository = new SupabaseTrackerRepository(owner.client);
  const services = createTrackerServices({
    repository,
    clock: fixedClock(TODAY),
    jobCollector: collector,
  });
  const watch = await services.addWatchedCompany(
    {
      requestId: rid(),
      company: "Acme Filter",
      boards: [{ provider: "GREENHOUSE", boardIdentifier: "acme-filter" }],
    },
    owner.actor,
  );
  const check = () => services.checkForNewJobs({ watchId: watch.watchId }, owner.actor);
  const save = (overrides: Record<string, unknown> = {}, expectedVersion?: number) =>
    services.saveSearchPreferences(
      { requestId: rid(), ...PREFERENCES, ...overrides, expectedVersion },
      owner.actor,
    );
  const leads = async () =>
    (
      await pgQuery(
        `select provider_posting_id, title, match_status::text, arrangement, city_rank, role_fit,
           review_status::text, availability::text, version, locations, workplace_type,
           evaluation_key
         from leads where user_id=$1 order by provider_posting_id`,
        [owner.id],
      )
    ).rows;
  return { owner, services, repository, check, save, leads };
}

beforeEach(() => {
  board = complete([]);
});

describe("search preferences and lead filtering in the database (decision 026)", () => {
  it("never loses a graduation-window posting before preferences are saved", async () => {
    const { owner, services, check, leads } = await setup("neutral-graduation");
    await services.saveCandidateProfile({ graduationDate: "2027-05-15" }, owner.actor);
    board = complete([
      posting("g", "Software Engineer", {
        description: "Candidates must be graduating between January 2025 and December 2025.",
      }),
    ]);
    expect((await check()).totals).toMatchObject({ created: 1, filtered: 0 });
    expect((await leads())[0]).toMatchObject({ match_status: "ELIGIBLE" });
  });

  it("rejects stale posting inputs while allowing concurrent review actions", async () => {
    const { owner, services, repository, check, save, leads } = await setup("input-revision");
    board = complete([posting("a", "Software Engineer")]);
    await check();
    await save();
    const [input] = await repository.listLeadsToEvaluate(owner.id, { key: "outdated", limit: 1 });
    const key = evaluationKey(1, null);
    const evaluation = toStoredEvaluation(
      evaluatePosting(input!, {
        preferences: NEUTRAL_PREFERENCES,
        graduationDate: null,
        key,
      }),
      key,
    );
    const apply = () =>
      repository.applyLeadEvaluations(
        { actor: owner.actor, today: null },
        1,
        [{ leadId: input!.leadId, expectedInputRevision: input!.inputRevision, evaluation }],
        null,
      );
    await services.setLeadReviewStatus(
      { requestId: rid(), leadId: input!.leadId, expectedVersion: 1, reviewStatus: "DISMISSED" },
      owner.actor,
    );
    expect(await apply()).toEqual({ updated: 1 });
    board = complete([posting("a", "Senior Software Engineer")]);
    await check();
    expect(await apply()).toEqual({ updated: 0 });
    expect((await leads())[0]).toMatchObject({
      match_status: "EXCLUDED",
      review_status: "DISMISSED",
      version: 2,
    });
  });

  it("rejects an older graduation snapshot, including a profile's first save", async () => {
    const { owner, repository, services, check, save } = await setup("profile-guard");
    await save();
    board = complete([posting("a", "Software Engineer")]);
    await check();
    const [input] = await repository.listLeadsToEvaluate(owner.id, { key: "outdated", limit: 1 });
    const key = evaluationKey(1, null);
    const evaluation = toStoredEvaluation(
      evaluatePosting(input!, { preferences: NEUTRAL_PREFERENCES, graduationDate: null, key }),
      key,
    );
    await services.saveCandidateProfile({ graduationDate: "2027-05-15" }, owner.actor);
    await expectJwordError(
      repository.applyLeadEvaluations(
        { actor: owner.actor, today: null },
        1,
        [{ leadId: input!.leadId, expectedInputRevision: input!.inputRevision, evaluation }],
        null,
      ),
      "CONFLICT",
      "STALE_PROFILE",
    );
  });

  it("saves preferences with versions, receipts, audit rows, and no-ops", async () => {
    const { owner, services, save } = await setup("prefs-save");
    const command = { requestId: rid(), ...PREFERENCES };
    const first = await services.saveSearchPreferences(command, owner.actor);
    expect(first).toMatchObject({ version: 1, noop: false });
    expect(await services.saveSearchPreferences(command, owner.actor)).toMatchObject({
      replayed: true,
      version: 1,
    });
    expect(await services.getSearchPreferences(owner.actor)).toMatchObject({
      ...PREFERENCES,
      version: 1,
    });
    expect(await save({}, 1)).toMatchObject({ noop: true, version: 1 });
    await expectJwordError(save(), "CONFLICT", "STALE_VERSION");
    await expectJwordError(save({ hideRemoteOnly: false }, 5), "CONFLICT", "STALE_VERSION");
    expect(await save({ hideRemoteOnly: false, maxPostingAgeDays: 30 }, 1)).toMatchObject({
      version: 2,
    });
    const audit = await pgQuery(
      "select version, summary, metadata from search_preference_activities where user_id=$1 order by version",
      [owner.id],
    );
    expect(audit.rows.map((r) => [r.version, r.summary])).toEqual([
      [1, "Saved search preferences"],
      [2, "Updated search preferences"],
    ]);
    expect(audit.rows[1].metadata.before.hideRemoteOnly).toBe(true);
    expect(audit.rows[1].metadata.after.maxPostingAgeDays).toBe(30);
  });

  it("filters new hard-rule exclusions at collection and counts them on the scan", async () => {
    const { owner, save, check, leads } = await setup("prefs-collect");
    await save();
    board = complete([
      posting("backend", "Backend Engineer", {
        locations: ["New York, NY", "San Francisco, CA"],
        workplaceType: "HYBRID",
        employmentType: "FULL_TIME",
      }),
      posting("frontend", "Frontend Engineer"),
      posting("remote", "Software Engineer", { location: "Remote (US)" }),
      posting("senior", "Senior Software Engineer"),
      posting("intern", "Software Engineer Intern"),
    ]);
    const result = await check();
    expect(result.totals).toMatchObject({
      created: 3,
      filtered: 2,
      filteredReasons: { SENIORITY: 1, INTERNSHIP: 1 },
    });
    const rows = await leads();
    expect(rows.map((r) => r.provider_posting_id)).toEqual(["backend", "frontend", "remote"]);
    expect(rows[0]).toMatchObject({
      match_status: "ELIGIBLE",
      arrangement: "HYBRID",
      city_rank: 1,
      role_fit: "PREFERRED",
      locations: ["New York, NY", "San Francisco, CA"],
      workplace_type: "HYBRID",
    });
    expect(rows[1]).toMatchObject({ role_fit: "DEEMPHASIZED", match_status: "ELIGIBLE" });
    expect(rows[2]).toMatchObject({ arrangement: "REMOTE", match_status: "ELIGIBLE" });
    const scan = await pgQuery(
      "select postings_seen, created_count, filtered_count, filtered_reasons from lead_scans where user_id=$1",
      [owner.id],
    );
    expect(scan.rows[0]).toMatchObject({
      postings_seen: 5,
      created_count: 3,
      filtered_count: 2,
      filtered_reasons: { SENIORITY: 1, INTERNSHIP: 1 },
    });
  });

  it("refreshes and re-evaluates existing leads without touching review, version, or availability", async () => {
    const { owner, services, save, check, leads } = await setup("prefs-reeval");
    board = complete([
      posting("a", "Senior Software Engineer"),
      posting("b", "Software Engineer", { location: "Chicago, IL" }),
    ]);
    await check(); // no preferences: nothing excluded
    const [a] = await leads();
    expect(a!.match_status).toBe("ELIGIBLE");
    const lead = (
      await pgQuery("select id from leads where user_id=$1 and provider_posting_id='a'", [owner.id])
    ).rows[0]!;
    await services.setLeadReviewStatus(
      { requestId: rid(), leadId: lead.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
      owner.actor,
    );

    const saved = await save();
    expect(saved.reevaluated).toBe(2);
    let rows = await leads();
    expect(rows[0]).toMatchObject({
      match_status: "EXCLUDED",
      review_status: "DISMISSED",
      version: 2,
      availability: "AVAILABLE",
    });
    expect(rows[1]).toMatchObject({ match_status: "ELIGIBLE", city_rank: 3 });

    // A later scan still refreshes the excluded lead and keeps it listed.
    board = complete([
      posting("a", "Senior Software Engineer II"),
      posting("b", "Software Engineer", { location: "Chicago, IL" }),
    ]);
    const again = await check();
    expect(again.totals).toMatchObject({ created: 0, updated: 1, markedUnavailable: 0 });
    rows = await leads();
    expect(rows[0]).toMatchObject({
      title: "Senior Software Engineer II",
      review_status: "DISMISSED",
    });

    const filtered = await services.listLeads({ view: "FILTERED" }, owner.actor);
    expect(filtered.items.map((l) => l.postingId)).toEqual(["a"]);
    const recommended = await services.listLeads({}, owner.actor);
    expect(recommended.items.map((l) => l.postingId)).toEqual(["b"]);
  });

  it("serves views, age limits, and city sorting through PostgREST", async () => {
    const { owner, services, save, check } = await setup("prefs-views");
    await save({ maxPostingAgeDays: 30 });
    board = complete([
      posting("nyc", "Backend Engineer", { postedOn: "2026-09-10" }),
      posting("sf", "Software Engineer", { location: "San Francisco, CA" }),
      posting("old", "Software Engineer", { location: "Boston, MA", postedOn: "2026-05-01" }),
      posting("remote", "Software Engineer", { location: "Remote (US)" }),
      posting("fe", "Frontend Engineer", { location: "Denver, CO" }),
    ]);
    await check();
    const ids = async (input: Record<string, unknown>) =>
      (await services.listLeads(input, owner.actor)).items.map((l) => l.postingId);
    expect((await ids({})).sort()).toEqual(["fe", "nyc", "sf"]);
    expect(await ids({ view: "REMOTE" })).toEqual(["remote"]);
    expect((await ids({ view: "ALL" })).sort()).toEqual(["fe", "nyc", "old", "remote", "sf"]);
    expect((await ids({ view: "ALL", sort: "CITY" })).slice(0, 3)).toEqual(["sf", "nyc", "old"]);
    expect(await ids({ view: "ALL", role: "PREFERRED" })).toEqual(["nyc"]);
    expect((await ids({ view: "ALL", role: "NOT_DEEMPHASIZED" })).sort()).toEqual([
      "nyc",
      "old",
      "remote",
      "sf",
    ]);
    // Combined with text search (two OR groups must both apply).
    expect(await ids({ text: "Backend" })).toEqual(["nyc"]);
  });

  it("refuses stale re-evaluations and invalid evaluation payloads", async () => {
    const { owner, save, check } = await setup("prefs-guards");
    board = complete([posting("a", "Software Engineer")]);
    await check();
    await save();
    const lead = (await pgQuery("select id from leads where user_id=$1", [owner.id])).rows[0]!;
    const apply = (command: unknown) =>
      owner.client.rpc("apply_lead_evaluations", {
        p_owner_id: owner.id,
        p_command: { graduationDate: null, ...(command as Record<string, unknown>) } as Json,
      });
    const key = evaluationKey(1, null);
    const evaluation = toStoredEvaluation(
      evaluatePosting(posting("a", "Software Engineer"), {
        preferences: NEUTRAL_PREFERENCES,
        graduationDate: null,
        key,
      }),
      key,
    );
    const stale = await apply({
      preferencesVersion: 0,
      evaluations: [{ leadId: lead.id, expectedInputRevision: 1, evaluation }],
    });
    expect(stale.error?.hint).toBe("STALE_PREFERENCES");
    const badMatch = await apply({
      preferencesVersion: 1,
      evaluations: [
        {
          leadId: lead.id,
          expectedInputRevision: 1,
          evaluation: { ...evaluation, match: "MAYBE" },
        },
      ],
    });
    expect(badMatch.error?.hint).toBe("INVALID_FIELD");
    const excludedWithoutReason = await apply({
      preferencesVersion: 1,
      evaluations: [
        {
          leadId: lead.id,
          expectedInputRevision: 1,
          evaluation: { ...evaluation, match: "EXCLUDED" },
        },
      ],
    });
    expect(excludedWithoutReason.error?.hint).toBe("INVALID_FIELD");
    for (const detail of [
      {},
      { ...evaluation.detail, cities: null },
      { ...evaluation.detail, cities: ["ATLANTIS"], cityRank: 1 },
      { ...evaluation.detail, flags: [{ code: "NOT_REAL", field: "title", evidence: "x" }] },
      { ...evaluation.detail, flags: [{ code: "LEVEL_UNCLEAR", field: "title" }] },
      { ...evaluation.detail, match: "EXCLUDED" },
      { ...evaluation.detail, arrangement: "REMOTE", arrangementField: "location" },
      { ...evaluation.detail, startMonth: "2027-13" },
    ]) {
      const invalid = await apply({
        preferencesVersion: 1,
        evaluations: [
          { leadId: lead.id, expectedInputRevision: 1, evaluation: { ...evaluation, detail } },
        ],
      });
      expect(invalid.error?.code, JSON.stringify(detail)).toBe("JW422");
    }
    const valid = await apply({
      preferencesVersion: 1,
      evaluations: [{ leadId: lead.id, expectedInputRevision: 1, evaluation }],
    });
    expect(valid.error).toBeNull();
    expect(valid.data).toEqual({ updated: 1 });
    const version = await pgQuery("select version, match_status::text from leads where id=$1", [
      lead.id,
    ]);
    expect(version.rows[0]).toMatchObject({ version: 1 });
  });

  it("keeps preferences owner-only and writes function-only", async () => {
    const { owner, save } = await setup("prefs-rls");
    const other = await createTestUser("prefs-rls-other");
    await save();
    expect((await other.client.from("search_preferences").select("*")).data).toEqual([]);
    expect((await other.client.from("search_preference_activities").select("*")).data).toEqual([]);
    expect((await anonClient().from("search_preferences").select("*")).data ?? []).toEqual([]);
    const direct = await owner.client
      .from("search_preferences")
      .update({ hide_remote_only: false })
      .eq("user_id", owner.id);
    expect(
      direct.error?.code === "42501" || /permission denied/i.test(direct.error?.message ?? ""),
    ).toBe(true);
    const mismatch = await other.client.rpc("save_search_preferences", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { ...PREFERENCES } as Json,
    });
    expect(mismatch.error?.hint).toBe("OWNER_MISMATCH");
    const foreignApply = await other.client.rpc("apply_lead_evaluations", {
      p_owner_id: owner.id,
      p_command: { preferencesVersion: 1, evaluations: [] } as Json,
    });
    expect(foreignApply.error?.hint).toBe("OWNER_MISMATCH");
    const invalid = await owner.client.rpc("save_search_preferences", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { ...PREFERENCES, preferredCities: ["chicago"], expectedVersion: 1 } as Json,
    });
    expect(invalid.error?.hint).toBe("INVALID_FIELD");
  });
});

async function connection() {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  await client.query("set statement_timeout = '8s'");
  const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid as number;
  return { client, pid };
}
async function blockedBy(holder: number, waiter: number) {
  await vi.waitFor(async () => {
    expect(
      (await pgQuery("select $1 = any(pg_blocking_pids($2)) blocked", [holder, waiter])).rows[0]
        .blocked,
    ).toBe(true);
  });
}

describe("preference and evaluation concurrency", () => {
  it("refuses the second simultaneous first save instead of overwriting the winner", async () => {
    const { owner } = await setup("first-save-race");
    const a = await connection(),
      b = await connection();
    let contender: Promise<unknown> | undefined;
    try {
      await a.client.query("begin");
      await a.client.query("select public.save_search_preferences($1,'USER',$2,$3::jsonb)", [
        owner.id,
        rid(),
        JSON.stringify(PREFERENCES),
      ]);
      contender = b.client
        .query("select public.save_search_preferences($1,'USER',$2,$3::jsonb)", [
          owner.id,
          rid(),
          JSON.stringify({ ...PREFERENCES, hideRemoteOnly: false }),
        ])
        .catch((e: unknown) => e);
      await blockedBy(a.pid, b.pid);
      await a.client.query("commit");
      expect(await contender).toMatchObject({ code: "JW409", hint: "STALE_VERSION" });
      expect(
        (
          await pgQuery(
            "select version, hide_remote_only from search_preferences where user_id=$1",
            [owner.id],
          )
        ).rows,
      ).toEqual([{ version: 1, hide_remote_only: true }]);
      expect(
        (
          await pgQuery(
            "select count(*)::int n from search_preference_activities where user_id=$1",
            [owner.id],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await a.client.query("rollback");
      await contender;
      await a.client.end();
      await b.client.end();
    }
  });

  it.each(["preferences", "profile"])(
    "waits for a first %s save and rejects the obsolete evaluation snapshot",
    async (kind) => {
      const { owner } = await setup(`evaluation-first-${kind}`);
      const a = await connection(),
        b = await connection();
      let contender: Promise<unknown> | undefined;
      try {
        await a.client.query("begin");
        if (kind === "preferences") {
          await a.client.query("select public.save_search_preferences($1,'USER',$2,$3::jsonb)", [
            owner.id,
            rid(),
            JSON.stringify(PREFERENCES),
          ]);
        } else {
          await a.client.query("select public.save_candidate_profile($1,$2::jsonb)", [
            owner.id,
            JSON.stringify({ graduationDate: "2027-05-15" }),
          ]);
        }
        contender = b.client
          .query("select public.apply_lead_evaluations($1,$2::jsonb)", [
            owner.id,
            JSON.stringify({ preferencesVersion: 0, graduationDate: null, evaluations: [] }),
          ])
          .catch((e: unknown) => e);
        await blockedBy(a.pid, b.pid);
        await a.client.query("commit");
        expect(await contender).toMatchObject({
          code: "JW409",
          hint: kind === "preferences" ? "STALE_PREFERENCES" : "STALE_PROFILE",
        });
      } finally {
        await a.client.query("rollback");
        await contender;
        await a.client.end();
        await b.client.end();
      }
    },
  );
});
