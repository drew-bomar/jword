import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  cleanupUsers,
  closePg,
  createTestUser,
  db,
  expectJwordError,
  mcpServicesFor,
  pgQuery,
  rid,
  TODAY,
  type TestUser,
} from "./helpers";
import {
  createFixtureBoardDirectory,
  createTrackerServices,
  fixedClock,
  SupabaseTrackerRepository,
  type Json,
} from "@jword/core";

/** Company watchlist (decision 018) against the local database. */
describe("company watchlist: permissions, integrity, and atomicity", () => {
  let owner: TestUser;
  let other: TestUser;
  let watchId: string;
  let companyId: string;
  let otherWatchId: string;
  let otherCompanyId: string;

  const watches = async (userId: string) =>
    (await pgQuery("select * from public.company_watches where user_id = $1", [userId])).rows;
  const audit = async (id: string) =>
    (
      await pgQuery(
        "select type, actor_type, metadata from public.company_watch_activities where watch_id = $1 order by created_at",
        [id],
      )
    ).rows;

  beforeAll(async () => {
    owner = await createTestUser("watch-owner");
    other = await createTestUser("watch-other");
    const app = await owner.services.createApplication(
      { requestId: rid(), company: "Stripe", title: "Engineer" },
      owner.actor,
    );
    const created = await owner.services.addWatchedCompany(
      {
        requestId: rid(),
        company: " stripe ",
        boards: [{ provider: "GREENHOUSE", boardIdentifier: "stripe" }],
      },
      owner.actor,
    );
    expect(created).toMatchObject({ companyId: app.companyId, companyCreated: false, version: 1 });
    watchId = created.watchId;
    companyId = created.companyId;
    const theirs = await other.services.addWatchedCompany(
      {
        requestId: rid(),
        company: "Theirs",
        boards: [{ provider: "LEVER", boardIdentifier: "theirs" }],
      },
      other.actor,
    );
    otherWatchId = theirs.watchId;
    otherCompanyId = theirs.companyId;
  });

  afterAll(async () => {
    await cleanupUsers();
    await closePg();
  });

  it("owner reads own watch rows, audit, and the overview; another user sees none", async () => {
    for (const table of [
      "company_watches",
      "company_watch_boards",
      "company_watch_activities",
    ] as const) {
      const mine = await owner.client.from(table).select("*");
      expect(mine.error, table).toBeNull();
      expect(mine.data?.length, table).toBe(1);
    }
    const overview = await owner.client.from("company_watch_overview").select("*");
    expect(overview.data).toEqual([
      expect.objectContaining({
        watch_id: watchId,
        company_name: "Stripe",
        boards: [
          {
            provider: "GREENHOUSE",
            boardIdentifier: "stripe",
            boardUrl: "https://job-boards.greenhouse.io/stripe",
          },
        ],
        board_providers: ["GREENHOUSE"],
        application_count: 1,
        last_event_type: "WATCH_CREATED",
      }),
    ]);
    const leak = await other.client.from("company_watch_overview").select("watch_id");
    expect(leak.data?.map((r) => r.watch_id)).toEqual([otherWatchId]);
    await expectJwordError(other.services.getWatchedCompany({ watchId }, other.actor), "NOT_FOUND");
    await expectJwordError(
      other.services.setCompanyWatchStatus(
        { requestId: rid(), watchId, expectedVersion: 1, active: false },
        other.actor,
      ),
      "NOT_FOUND",
    );
  });

  it("anonymous clients cannot read watches or call the functions", async () => {
    const anon = anonClient();
    for (const table of [
      "company_watches",
      "company_watch_activities",
      "company_watch_overview",
    ] as const) {
      const { error } = await (anon.from as (name: string) => ReturnType<typeof anon.from>)(
        table,
      ).select("*");
      expect(error?.code, table).toBe("42501");
    }
    for (const fn of [
      "create_company_watch",
      "update_company_watch",
      "set_company_watch_active",
    ] as const) {
      const { error } = await anon.rpc(fn, {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: {},
      });
      expect(error?.code, fn).toBe("42501");
    }
  });

  it("authenticated direct table writes are denied even for the owner's own rows", async () => {
    const denied = (error: { code?: string; message?: string } | null) =>
      error !== null && (error.code === "42501" || /permission denied/i.test(error.message ?? ""));
    const insert = await owner.client.from("company_watches").insert({
      user_id: owner.id,
      company_id: companyId,
    });
    expect(denied(insert.error)).toBe(true);
    const board = await owner.client.from("company_watch_boards").insert({
      user_id: owner.id,
      watch_id: watchId,
      position: 2,
      provider: "LEVER",
      board_identifier: "sneaky",
      board_url: "https://jobs.lever.co/sneaky",
    });
    expect(denied(board.error)).toBe(true);
    const update = await owner.client
      .from("company_watches")
      .update({ active: false })
      .eq("id", watchId);
    expect(denied(update.error)).toBe(true);
    const del = await owner.client.from("company_watches").delete().eq("id", watchId);
    expect(denied(del.error)).toBe(true);
    const forged = await owner.client.from("company_watch_activities").insert({
      user_id: owner.id,
      watch_id: watchId,
      type: "WATCH_DEACTIVATED",
      actor_type: "USER",
      summary: "forged",
    });
    expect(denied(forged.error)).toBe(true);
    expect((await watches(owner.id))[0]).toMatchObject({ active: true, version: 1 });
    expect(await audit(watchId)).toHaveLength(1);
  });

  it("composite FKs block cross-owner links; constraints guard uniqueness, board shape, and the cap of three", async () => {
    await expect(
      pgQuery("insert into public.company_watches (user_id, company_id) values ($1, $2)", [
        owner.id,
        otherCompanyId,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pgQuery(
        "insert into public.company_watch_activities (user_id, watch_id, type, actor_type, summary) values ($1, $2, 'WATCH_UPDATED', 'USER', 'x')",
        [owner.id, otherWatchId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pgQuery(
        "insert into public.company_watch_boards (user_id, watch_id, position, provider, board_identifier, board_url) values ($1, $2, 2, 'ASHBY', 'x', 'https://jobs.ashbyhq.com/x')",
        [owner.id, otherWatchId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pgQuery("insert into public.company_watches (user_id, company_id) values ($1, $2)", [
        owner.id,
        companyId,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    const board = (provider: string, identifier: string | null, url: string, position = 2) =>
      pgQuery(
        "insert into public.company_watch_boards (user_id, watch_id, position, provider, board_identifier, board_url) values ($1, $2, $3, $4, $5, $6)",
        [owner.id, watchId, position, provider, identifier, url],
      );
    // Board URL must be the canonical one; OTHER has no identifier; position caps at three.
    await expect(board("LEVER", "scratch", "https://evil.example/scratch")).rejects.toMatchObject({
      code: "23514",
    });
    await expect(board("OTHER", "x", "https://x.example/jobs")).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      board("ASHBY", "fourth", "https://jobs.ashbyhq.com/fourth", 4),
    ).rejects.toMatchObject({ code: "23514" });
    // The same board under a second company, any case, violates the owner-wide unique index.
    await expect(board("LEVER", "THEIRS", "https://jobs.lever.co/THEIRS")).resolves.toBeTruthy();
    await pgQuery("delete from public.company_watch_boards where watch_id = $1 and position = 2", [
      watchId,
    ]);
    await expect(
      board("GREENHOUSE", "STRIPE", "https://job-boards.greenhouse.io/STRIPE"),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a selected company id owned by someone else is NOT_FOUND and writes nothing", async () => {
    const receiptsBefore = (await db.receipts(owner.id)).length;
    await expectJwordError(
      owner.services.addWatchedCompany(
        { requestId: rid(), companyId: otherCompanyId },
        owner.actor,
      ),
      "NOT_FOUND",
      "COMPANY_NOT_FOUND",
    );
    expect(await watches(owner.id)).toHaveLength(1);
    expect((await db.receipts(owner.id)).length).toBe(receiptsBefore);
  });

  it("a second watch for the same company is ALREADY_WATCHED with the existing id", async () => {
    const error = await expectJwordError(
      owner.services.addWatchedCompany({ requestId: rid(), company: "STRIPE" }, owner.actor),
      "CONFLICT",
      "ALREADY_WATCHED",
    );
    expect(error.details).toMatchObject({ watchId, watchActive: true, currentVersion: 1 });
  });

  it("direct RPC input is validated before anything is written", async () => {
    const receiptsBefore = (await db.receipts(owner.id)).length;
    const companiesBefore = (await db.companies(owner.id)).length;
    const b = (board: Record<string, string>) => ({ company: "X", boards: [board] });
    const bad: Json[] = [
      { company: "X", surprise: true },
      { company: "X", boards: "GREENHOUSE" },
      b({ provider: "WORKDAY", boardIdentifier: "x" }),
      b({ provider: "LEVER", boardIdentifier: "../etc" }),
      b({ provider: "OTHER", boardUrl: "javascript:alert(1)" }),
      b({ provider: "OTHER" }),
      b({ provider: "LEVER" }),
      b({ provider: "LEVER", boardIdentifier: "x", boardUrl: "https://jobs.lever.co/x" }),
      b({ provider: "LEVER", boardIdentifier: "x", extra: "y" }),
      {
        company: "X",
        boards: ["a", "b", "c", "d"].map((id) => ({ provider: "ASHBY", boardIdentifier: id })),
      },
      {
        company: "X",
        boards: [
          { provider: "ASHBY", boardIdentifier: "dup" },
          { provider: "ASHBY", boardIdentifier: "DUP" },
        ],
      },
      { company: "X", interestLevel: 9 },
      {},
    ];
    for (const command of bad) {
      const { error } = await owner.client.rpc("create_company_watch", {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: command,
      });
      expect(error?.code, JSON.stringify(command)).toBe("JW422");
    }
    const { error: empty } = await owner.client.rpc("update_company_watch", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { watchId, expectedVersion: 1 },
    });
    expect(empty?.hint).toBe("EMPTY_UPDATE");
    expect((await db.receipts(owner.id)).length).toBe(receiptsBefore);
    expect((await db.companies(owner.id)).length).toBe(companiesBefore);
  });

  it("an audit-row failure rolls back the watch, the company it created, and the receipt", async () => {
    await pgQuery(
      `create table if not exists public.__jword_watch_fail (user_id uuid primary key)`,
    );
    await pgQuery(`
      create or replace function public.__jword_watch_fail_fn() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from public.__jword_watch_fail where user_id = new.user_id) then
          raise exception 'injected audit failure';
        end if;
        return new;
      end $$`);
    await pgQuery(`
      create trigger __jword_watch_fail before insert on public.company_watch_activities
      for each row execute function public.__jword_watch_fail_fn()`);
    try {
      await pgQuery("insert into public.__jword_watch_fail (user_id) values ($1)", [owner.id]);
      const requestId = rid();
      const command = {
        requestId,
        company: "Atomic Co",
        boards: [{ provider: "ASHBY" as const, boardIdentifier: "atomic" }],
        interestLevel: 3,
      };
      await expect(owner.services.addWatchedCompany(command, owner.actor)).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
      });
      await expect(
        owner.services.setCompanyWatchStatus(
          { requestId: rid(), watchId, expectedVersion: 1, active: false },
          owner.actor,
        ),
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await watches(owner.id)).toEqual([
        expect.objectContaining({ id: watchId, active: true, version: 1 }),
      ]);
      expect((await db.companies(owner.id)).some((c) => c.name === "Atomic Co")).toBe(false);
      const receipt = await pgQuery(
        "select 1 from public.mutation_requests where user_id = $1 and request_id = $2",
        [owner.id, requestId],
      );
      expect(receipt.rowCount).toBe(0);

      await pgQuery("delete from public.__jword_watch_fail where user_id = $1", [owner.id]);
      const retry = await owner.services.addWatchedCompany(command, owner.actor);
      expect(retry).toMatchObject({ replayed: false, companyCreated: true });
      expect(await audit(retry.watchId)).toHaveLength(1);
    } finally {
      await pgQuery("drop trigger if exists __jword_watch_fail on public.company_watch_activities");
      await pgQuery("drop function if exists public.__jword_watch_fail_fn()");
      await pgQuery("drop table if exists public.__jword_watch_fail");
    }
  });

  it("deactivate/reactivate keep the company, applications, and history; versions and retries hold", async () => {
    const appsBefore = await db.apps(owner.id);
    const companyBefore = (await db.companies(owner.id)).find((c) => c.id === companyId);
    const requestId = rid();
    const command = { requestId, watchId, expectedVersion: 1, active: false };
    const off = await owner.services.setCompanyWatchStatus(command, owner.actor);
    expect(off).toMatchObject({ active: false, version: 2, noop: false });
    expect(await owner.services.setCompanyWatchStatus(command, owner.actor)).toMatchObject({
      replayed: true,
      version: 2,
    });
    await expectJwordError(
      owner.services.updateWatchedCompany(
        { requestId: rid(), watchId, expectedVersion: 1, interestLevel: 2 },
        owner.actor,
      ),
      "CONFLICT",
      "STALE_VERSION",
    );
    const on = await owner.services.setCompanyWatchStatus(
      { requestId: rid(), watchId, expectedVersion: 2, active: true },
      owner.actor,
    );
    expect(on).toMatchObject({ active: true, version: 3 });
    expect(await db.apps(owner.id)).toEqual(appsBefore);
    expect((await db.companies(owner.id)).find((c) => c.id === companyId)).toEqual(companyBefore);
    expect((await audit(watchId)).map((a) => a.type)).toEqual([
      "WATCH_CREATED",
      "WATCH_DEACTIVATED",
      "WATCH_ACTIVATED",
    ]);
  });

  it("MCP path: the service-role client is locked to the configured owner", async () => {
    const { services, actor } = mcpServicesFor(owner.id);
    const page = await services.listWatchedCompanies({ limit: 25 }, actor);
    expect(page.items.map((w) => w.watchId)).not.toContain(otherWatchId);
    expect(page.items.map((w) => w.company).sort()).toEqual(["Atomic Co", "Stripe"]);
    await expectJwordError(
      services.getWatchedCompany({ watchId: otherWatchId }, actor),
      "NOT_FOUND",
    );
    await expectJwordError(
      services.updateWatchedCompany(
        { requestId: rid(), watchId: otherWatchId, expectedVersion: 1, interestLevel: 1 },
        actor,
      ),
      "NOT_FOUND",
    );
    expect(await services.searchCompanies({ text: "Theirs" }, actor)).toEqual([]);
    const current = (await services.getWatchedCompany({ watchId }, actor)).watch;
    const edited = await services.updateWatchedCompany(
      {
        requestId: rid(),
        watchId,
        expectedVersion: current.version,
        websiteUrl: "https://stripe.com",
        companyNotes: "private note",
      },
      actor,
    );
    expect(edited.changedFields).toEqual(["websiteUrl", "companyNotes"]);
    expect(JSON.stringify(edited)).not.toContain("private note");
    const last = (await audit(watchId)).at(-1)!;
    expect(last).toMatchObject({ type: "WATCH_UPDATED", actor_type: "CODEX" });
    expect(JSON.stringify(last.metadata)).not.toContain("private note");
    expect((await watches(other.id))[0]).toMatchObject({ version: 1, active: true });
  });

  it("discovery reads only the owner's job links and watches, on both web and MCP clients", async () => {
    await other.services.createApplication(
      {
        requestId: rid(),
        company: "Secret Corp",
        title: "SWE",
        jobUrl: "https://jobs.lever.co/secret/1",
      },
      other.actor,
    );
    await owner.services.createApplication(
      {
        requestId: rid(),
        company: "Linear",
        title: "SWE",
        jobUrl: "https://jobs.ashbyhq.com/linear/abc",
      },
      owner.actor,
    );
    const directory = createFixtureBoardDirectory({
      LEVER: {
        stripe: {
          status: "found",
          boardName: "Stripe",
          website: null,
          openJobs: 3,
          openJobsAtLeast: false,
          sampleTitles: [],
        },
      },
    });
    const build = (client: typeof owner.client) =>
      createTrackerServices({
        repository: new SupabaseTrackerRepository(client),
        clock: fixedClock(TODAY),
        boardDirectory: directory,
      });
    for (const [services, actor] of [
      [build(owner.client), owner.actor],
      [build(adminClient()), mcpServicesFor(owner.id).actor],
    ] as const) {
      const suggestions = await services.suggestWatchesFromApplications(actor);
      expect(suggestions.map((x) => x.company)).toEqual(["Linear"]);
      const found = await services.discoverCompanyBoards({ company: "stripe" }, actor);
      expect(found.companyId).toBe(companyId);
      expect(found.suggestions.map((x) => [x.provider, x.watchedBy?.company ?? null])).toEqual([
        ["LEVER", null],
      ]);
      const theirs = await services.discoverCompanyBoards({ company: "Secret Corp" }, actor);
      expect(theirs.companyId).toBeNull();
      expect(theirs.suggestions).toEqual([]);
      await expectJwordError(
        services.discoverCompanyBoards({ companyId: otherCompanyId }, actor),
        "NOT_FOUND",
      );
    }
  });
});
