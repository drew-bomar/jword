import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFixtureJobCollector,
  createTrackerServices,
  fixedClock,
  fixturePosting,
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

const GH = "https://job-boards.greenhouse.io/acme-leads/jobs";
const posting = (id: string, title = `Role ${id}`, extra: Partial<CollectedPosting> = {}) =>
  fixturePosting(GH, id, title, extra);
const complete = (postings: CollectedPosting[]): CollectionResult => ({
  status: "complete",
  reason: null,
  postings,
  reportedTotal: null,
});

let board: CollectionResult;
const collector = createFixtureJobCollector({ GREENHOUSE: { "acme-leads": () => board } });

function servicesFor(user: TestUser) {
  return createTrackerServices({
    repository: new SupabaseTrackerRepository(user.client),
    clock: fixedClock(TODAY),
    jobCollector: collector,
  });
}

async function setup(label: string) {
  const owner = await createTestUser(label);
  const services = servicesFor(owner);
  const watch = await services.addWatchedCompany(
    {
      requestId: rid(),
      company: "Acme Leads",
      boards: [{ provider: "GREENHOUSE", boardIdentifier: "acme-leads" }],
    },
    owner.actor,
  );
  const check = () => services.checkForNewJobs({ watchId: watch.watchId }, owner.actor);
  const leads = async () =>
    (
      await pgQuery(
        "select id, provider_posting_id, title, availability::text, review_status::text, version, application_id, posted_on::text from leads where user_id=$1 order by provider_posting_id",
        [owner.id],
      )
    ).rows;
  return { owner, services, watch, check, leads };
}

beforeEach(() => {
  board = complete([posting("1"), posting("2")]);
});

describe("job collection and leads in the database (decision 024)", () => {
  it("saves leads once, keeps review decisions, and only complete scans mark unavailable", async () => {
    const { owner, services, check, leads } = await setup("leads-flow");
    expect((await check()).totals).toMatchObject({ created: 2, complete: 1 });
    const [first] = await leads();
    await services.setLeadReviewStatus(
      { requestId: rid(), leadId: first!.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
      owner.actor,
    );

    board = {
      status: "partial",
      reason: "PAGE_FAILED",
      postings: [posting("1", "Renamed")],
      reportedTotal: null,
    };
    expect((await check()).boards[0]).toMatchObject({
      status: "partial",
      updated: 1,
      markedUnavailable: 0,
    });
    expect((await leads()).map((l) => [l.title, l.availability, l.review_status])).toEqual([
      ["Renamed", "AVAILABLE", "DISMISSED"],
      ["Role 2", "AVAILABLE", "NEW"],
    ]);

    board = complete([posting("1", "Renamed")]);
    expect((await check()).boards[0]).toMatchObject({ markedUnavailable: 1 });
    expect((await leads()).map((l) => l.availability)).toEqual(["AVAILABLE", "UNAVAILABLE"]);

    board = complete([posting("1", "Renamed"), posting("2")]);
    expect((await check()).totals).toMatchObject({ relisted: 1, created: 0 });
    const after = await leads();
    expect(after).toHaveLength(2);
    expect(after.map((l) => [l.availability, l.review_status])).toEqual([
      ["AVAILABLE", "DISMISSED"],
      ["AVAILABLE", "NEW"],
    ]);

    const scans = await pgQuery(
      "select status::text, reason, created_count, unavailable_count from lead_scans where user_id=$1 order by started_at",
      [owner.id],
    );
    expect(scans.rows.map((s) => s.status)).toEqual([
      "COMPLETE",
      "PARTIAL",
      "COMPLETE",
      "COMPLETE",
    ]);
    expect(await services.listLeadCompanies(owner.actor)).toEqual([
      expect.objectContaining({ company: "Acme Leads", leadCount: 2 }),
    ]);
  });

  it("runs one scan per board at a time; concurrent checks never duplicate leads", async () => {
    const { owner, leads, watch } = await setup("leads-concurrent");
    const begin = () =>
      owner.client.rpc("begin_lead_scan", {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_command: {
          watchId: watch.watchId,
          provider: "GREENHOUSE",
          boardIdentifier: "acme-leads",
        },
      });
    const [a, b] = await Promise.all([begin(), begin()]);
    const errors = [a.error, b.error].filter(Boolean);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.hint).toBe("SCAN_IN_PROGRESS");
    // Let the open scan look interrupted, then two checks race.
    await pgQuery(
      "update lead_scans set started_at = started_at - interval '10 minutes' where user_id=$1",
      [owner.id],
    );
    // A slow provider keeps the first scan open while the second check starts.
    const slow = createTrackerServices({
      repository: new SupabaseTrackerRepository(owner.client),
      clock: fixedClock(TODAY),
      jobCollector: {
        async collect(provider, identifier) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return collector.collect(provider, identifier);
        },
      },
    });
    const slowCheck = () => slow.checkForNewJobs({ watchId: watch.watchId }, owner.actor);
    const results = await Promise.all([slowCheck(), slowCheck()]);
    expect(results.map((r) => r.boards[0]!.status).sort()).toEqual(["complete", "failed"]);
    expect(await leads()).toHaveLength(2);
    const interrupted = await pgQuery(
      "select count(*)::int n from lead_scans where user_id=$1 and reason='INTERRUPTED'",
      [owner.id],
    );
    expect(interrupted.rows[0].n).toBe(1);
  });

  it("keeps leads and their source when the watch is deleted, and reuses them when re-added", async () => {
    const { owner, services, watch, check, leads } = await setup("leads-retain");
    await check();
    const before = await leads();
    await services.deleteWatchedCompany(
      { requestId: rid(), watchId: watch.watchId, expectedVersion: 1, confirmed: true },
      owner.actor,
    );
    expect(await leads()).toEqual(before);
    const again = await services.addWatchedCompany(
      {
        requestId: rid(),
        company: "Acme Leads",
        boards: [{ provider: "GREENHOUSE", boardIdentifier: "ACME-LEADS" }],
      },
      owner.actor,
    );
    const result = await services.checkForNewJobs({ watchId: again.watchId }, owner.actor);
    expect(result.totals).toMatchObject({ created: 0, found: 2 });
    expect((await leads()).map((l) => l.id)).toEqual(before.map((l) => l.id));
    const sources = await pgQuery("select board_identifier from lead_sources where user_id=$1", [
      owner.id,
    ]);
    expect(sources.rows).toEqual([{ board_identifier: "ACME-LEADS" }]);
  });

  it("creates one linked application per lead, retry-safe, with duplicate checks", async () => {
    board = complete([
      posting("1", "Backend Engineer", { postedOn: "2026-09-20" }),
      posting("2", "Frontend Engineer"),
    ]);
    const { owner, services, check, leads } = await setup("leads-promote");
    await check();
    const [backend, frontend] = await leads();
    const command = { requestId: rid(), leadId: backend!.id, expectedVersion: 1 };
    const created = await services.createApplicationFromLead(command, owner.actor);
    const replay = await services.createApplicationFromLead(command, owner.actor);
    expect(replay).toMatchObject({ replayed: true, applicationId: created.applicationId });
    await expectJwordError(
      services.createApplicationFromLead({ ...command, allowDuplicate: true }, owner.actor),
      "CONFLICT",
      "REQUEST_ID_REUSED",
    );
    const app = await services.getApplication(
      { applicationId: created.applicationId },
      owner.actor,
    );
    expect(app.application).toMatchObject({
      company: "Acme Leads",
      title: "Backend Engineer",
      status: "SAVED",
      jobUrl: `${GH}/1`,
      externalJobId: "1",
      datePosted: "2026-09-20",
      dateFound: TODAY,
      source: "Greenhouse",
    });
    expect((await leads())[0]).toMatchObject({
      review_status: "PROMOTED",
      application_id: created.applicationId,
      version: 2,
    });
    const apps = await pgQuery("select count(*)::int n from applications where user_id=$1", [
      owner.id,
    ]);
    expect(apps.rows[0].n).toBe(1);
    const activity = await pgQuery(
      "select type::text, metadata->>'leadId' lead from application_activities where user_id=$1",
      [owner.id],
    );
    expect(activity.rows).toEqual([{ type: "CREATED", lead: backend!.id }]);

    await services.createApplication(
      { requestId: rid(), company: "Acme Leads", title: "Frontend Engineer" },
      owner.actor,
    );
    const second = { requestId: rid(), leadId: frontend!.id, expectedVersion: 1 };
    await expectJwordError(
      services.createApplicationFromLead(second, owner.actor),
      "CONFLICT",
      "DUPLICATE_CANDIDATES",
    );
    expect((await leads())[1]).toMatchObject({ review_status: "NEW", application_id: null });
    await services.createApplicationFromLead({ ...second, allowDuplicate: true }, owner.actor);
    await expectJwordError(
      services.setLeadReviewStatus(
        { requestId: rid(), leadId: frontend!.id, expectedVersion: 2, reviewStatus: "DISMISSED" },
        owner.actor,
      ),
      "CONFLICT",
      "LEAD_PROMOTED",
    );
  });

  it("isolates owners and allows writes only through the functions", async () => {
    const { owner, check, leads, watch } = await setup("leads-owner");
    await check();
    const other = await createTestUser("leads-other");
    const [lead] = await leads();

    for (const table of [
      "leads",
      "lead_sources",
      "lead_scans",
      "lead_activities",
      "lead_overview",
    ] as const) {
      // Each relation is typed separately; the loop only needs a select.
      const relation = table as "leads";
      expect((await other.client.from(relation).select("*")).data, table).toEqual([]);
      expect((await anonClient().from(relation).select("*")).data ?? [], table).toEqual([]);
    }
    const insert = await owner.client
      .from("leads")
      .update({ review_status: "DISMISSED" })
      .eq("id", lead!.id);
    expect(
      insert.error?.code === "42501" || /permission denied/i.test(insert.error?.message ?? ""),
    ).toBe(true);

    const mismatch = await other.client.rpc("set_lead_review_status", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { leadId: lead!.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
    });
    expect(mismatch.error?.hint).toBe("OWNER_MISMATCH");
    const foreign = await other.client.rpc("set_lead_review_status", {
      p_owner_id: other.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { leadId: lead!.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
    });
    expect(foreign.error?.hint).toBe("LEAD_NOT_FOUND");
    const foreignScan = await other.client.rpc("begin_lead_scan", {
      p_owner_id: other.id,
      p_actor: "USER",
      p_command: { watchId: watch.watchId, provider: "GREENHOUSE", boardIdentifier: "acme-leads" },
    });
    expect(foreignScan.error?.hint).toBe("BOARD_NOT_WATCHED");
    const anon = await anonClient().rpc("finish_lead_scan", {
      p_owner_id: owner.id,
      p_command: { scanId: rid(), status: "FAILED", reason: "PROVIDER_ERROR" },
    });
    expect(anon.error).not.toBeNull();
  });

  it("validates scan commands and table invariants in SQL", async () => {
    const { owner, watch } = await setup("leads-validate");
    const call = (fn: "record_lead_postings" | "finish_lead_scan", command: unknown) =>
      owner.client.rpc(fn, { p_owner_id: owner.id, p_command: command as Json });
    const started = await owner.client.rpc("begin_lead_scan", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_command: { watchId: watch.watchId, provider: "GREENHOUSE", boardIdentifier: "acme-leads" },
    });
    const scanId = (started.data as { scanId: string }).scanId;
    const good = { postingId: "x", title: "T", jobUrl: `${GH}/x` };
    for (const bad of [
      { scanId, postings: Array.from({ length: 501 }, () => good) },
      { scanId, postings: [{ ...good, jobUrl: "javascript:alert(1)" }] },
      { scanId, postings: [{ ...good, title: "" }] },
      { scanId, postings: [{ ...good, postedOn: "yesterday" }] },
      { scanId, postings: [{ ...good, surprise: 1 }] },
      { scanId, postings: [good], extra: true },
    ]) {
      expect(
        (await call("record_lead_postings", bad)).error?.code,
        JSON.stringify(bad).slice(0, 80),
      ).toBe("JW422");
    }
    expect(
      (await call("finish_lead_scan", { scanId, status: "COMPLETE", reason: "PAGE_FAILED" })).error
        ?.code,
    ).toBe("JW422");
    expect(
      (await call("finish_lead_scan", { scanId, status: "PARTIAL", reason: "PAGE_FAILED" })).error,
    ).toBeNull();
    expect((await call("record_lead_postings", { scanId, postings: [good] })).error?.hint).toBe(
      "SCAN_FINISHED",
    );
    expect(
      (await call("finish_lead_scan", { scanId, status: "FAILED", reason: "X" })).error?.hint,
    ).toBe("SCAN_FINISHED");

    const leadCheck = await pgQuery("select count(*)::int n from leads where user_id=$1", [
      owner.id,
    ]);
    expect(leadCheck.rows[0].n).toBe(0);
    const source = await pgQuery("select id from lead_sources where user_id=$1", [owner.id]);
    await expect(
      pgQuery("update lead_sources set board_url='https://evil.example/acme-leads' where id=$1", [
        source.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// Separate connections and observed lock waits make these races deterministic.
async function connection() {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  await client.query("set statement_timeout = '8s'");
  const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid as number;
  return { client, pid };
}
async function blockedBy(holder: number, waiter: number) {
  await vi.waitFor(async () => {
    const result = await pgQuery("select $1 = any(pg_blocking_pids($2)) blocked", [holder, waiter]);
    expect(result.rows[0].blocked).toBe(true);
  });
}

describe("lead review concurrency regressions", () => {
  it("recovers a stale scan while its old worker tries to finish without deadlocking", async () => {
    const { owner, watch } = await setup("leads-stale-finish");
    const command = {
      watchId: watch.watchId,
      provider: "GREENHOUSE",
      boardIdentifier: "acme-leads",
    };
    const started = await owner.client.rpc("begin_lead_scan", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_command: command,
    });
    expect(started.error).toBeNull();
    const { scanId, sourceId } = started.data as { scanId: string; sourceId: string };
    await pgQuery(
      "update lead_scans set started_at = started_at - interval '6 minutes' where id=$1",
      [scanId],
    );
    const a = await connection();
    const b = await connection();
    let finishing: Promise<unknown> | undefined;
    try {
      await a.client.query("begin");
      await a.client.query("select id from lead_sources where id=$1 for update", [sourceId]);
      finishing = b.client
        .query("select public.finish_lead_scan($1,$2::jsonb)", [
          owner.id,
          JSON.stringify({ scanId, status: "COMPLETE" }),
        ])
        .catch((error) => error);
      await blockedBy(a.pid, b.pid);
      await a.client.query("select public.begin_lead_scan($1,'USER',$2::jsonb)", [
        owner.id,
        JSON.stringify(command),
      ]);
      await a.client.query("commit");
      expect(await finishing).toMatchObject({ code: "JW409", hint: "SCAN_FINISHED" });
    } finally {
      await a.client.query("rollback");
      await finishing;
      await a.client.end();
      await b.client.end();
    }
  });

  it.each(["lead", "manual"])(
    "serializes duplicate checks between promotion and %s creation",
    async (entry) => {
      board = complete([posting("1", "Engineer"), posting("2", "Engineer")]);
      const { owner, watch, check, leads } = await setup(`leads-duplicate-${entry}`);
      await check();
      const [first, second] = await leads();
      const a = await connection();
      const b = await connection();
      let contender: Promise<unknown> | undefined;
      try {
        await a.client.query("begin");
        await a.client.query("select public.create_application_from_lead($1,'USER',$2,$3::jsonb)", [
          owner.id,
          rid(),
          JSON.stringify({ leadId: first!.id, expectedVersion: 1 }),
        ]);
        const fn = entry === "lead" ? "create_application_from_lead" : "create_application";
        const command =
          entry === "lead"
            ? { leadId: second!.id, expectedVersion: 1 }
            : { company: "Acme Leads", companyId: watch.companyId, title: "Engineer" };
        contender = b.client
          .query(`select public.${fn}($1,'USER',$2,$3::jsonb)`, [
            owner.id,
            rid(),
            JSON.stringify(command),
          ])
          .catch((error) => error);
        await blockedBy(a.pid, b.pid);
        await a.client.query("commit");
        expect(await contender).toMatchObject({ code: "JW409", hint: "DUPLICATE_CANDIDATES" });
        expect(
          (await pgQuery("select count(*)::int n from applications where user_id=$1", [owner.id]))
            .rows[0].n,
        ).toBe(1);
        expect((await leads())[1]).toMatchObject({ review_status: "NEW", version: 1 });
      } finally {
        await a.client.query("rollback");
        await contender;
        await a.client.end();
        await b.client.end();
      }
    },
  );

  it.each(["dismiss", "promote"])(
    "refreshes a posting racing with %s without replacing the decision",
    async (action) => {
      const { owner, watch, check, leads } = await setup(`leads-review-${action}`);
      await check();
      const [first] = await leads();
      const started = await owner.client.rpc("begin_lead_scan", {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_command: {
          watchId: watch.watchId,
          provider: "GREENHOUSE",
          boardIdentifier: "acme-leads",
        },
      });
      expect(started.error).toBeNull();
      const { scanId } = started.data as { scanId: string };
      const a = await connection();
      const b = await connection();
      let recording: Promise<pg.QueryResult> | undefined;
      try {
        await a.client.query("begin");
        const fn = action === "dismiss" ? "set_lead_review_status" : "create_application_from_lead";
        await a.client.query(`select public.${fn}($1,'USER',$2,$3::jsonb)`, [
          owner.id,
          rid(),
          JSON.stringify({
            leadId: first!.id,
            expectedVersion: 1,
            ...(action === "dismiss" ? { reviewStatus: "DISMISSED" } : {}),
          }),
        ]);
        recording = b.client.query("select public.record_lead_postings($1,$2::jsonb)", [
          owner.id,
          JSON.stringify({ scanId, postings: [posting("1", "Refreshed title")] }),
        ]);
        await blockedBy(a.pid, b.pid);
        await a.client.query("commit");
        await recording;
        const [after] = await leads();
        expect(after).toMatchObject({
          title: "Refreshed title",
          version: 2,
          review_status: action === "dismiss" ? "DISMISSED" : "PROMOTED",
        });
        if (action === "promote") expect(after!.application_id).not.toBeNull();
      } finally {
        await a.client.query("rollback");
        await recording?.catch(() => {});
        await a.client.end();
        await b.client.end();
      }
    },
  );

  it("saves multiple chunks and preserves review versions across repeat collection", async () => {
    board = complete(Array.from({ length: 501 }, (_, i) => posting(String(i))));
    const { owner, services, check, leads } = await setup("leads-chunks");
    expect((await check()).totals.created).toBe(501);
    const [first] = await leads();
    await services.setLeadReviewStatus(
      { requestId: rid(), leadId: first!.id, expectedVersion: 1, reviewStatus: "DISMISSED" },
      owner.actor,
    );
    expect((await check()).totals.created).toBe(0);
    expect(await leads()).toHaveLength(501);
    expect((await leads())[0]).toMatchObject({ review_status: "DISMISSED", version: 2 });
  });

  it("keeps helpers private and fixes the search path on every new public function", async () => {
    const { rows } = await pgQuery(`select p.proname,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('begin_lead_scan','record_lead_postings','finish_lead_scan','set_lead_review_status','create_application_from_lead','delete_application')`);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toMatchObject({ anon: false, authenticated: true, prosecdef: true });
      expect(row.proconfig).toContain('search_path=""');
    }
    const helpers = await pgQuery(`select p.proname,
      has_function_privilege('authenticated',p.oid,'EXECUTE') callable
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='jword'
      and p.proname in ('lock_lead','lock_running_scan','add_lead_activity','scan_stale_after','create_application_from_lead','set_lead_review_status','delete_application','create_tracked_job')`);
    expect(helpers.rows).toHaveLength(8);
    expect(helpers.rows.every((row) => !row.callable)).toBe(true);
  });
});
