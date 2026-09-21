import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUsers, closePg, createTestUser, db, pgQuery, rid, type TestUser } from "./helpers";

/**
 * Fault injection: a temporary trigger on application_activities raises for any user
 * listed in a helper table. Every mutation function inserts its activity inside the same
 * transaction as the primary change, so the whole operation must roll back.
 */
describe("Atomic mutation + activity + receipt", () => {
  let u: TestUser;

  beforeAll(async () => {
    u = await createTestUser("atomic");
    await pgQuery(`create table if not exists public.__jword_fail_flag (user_id uuid primary key)`);
    await pgQuery(`
      create or replace function public.__jword_fail_activity() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from public.__jword_fail_flag where user_id = new.user_id) then
          raise exception 'injected activity failure';
        end if;
        return new;
      end $$`);
    await pgQuery(`drop trigger if exists __jword_fail_activity on public.application_activities`);
    await pgQuery(`
      create trigger __jword_fail_activity before insert on public.application_activities
      for each row execute function public.__jword_fail_activity()`);
  });

  afterAll(async () => {
    await pgQuery(`drop trigger if exists __jword_fail_activity on public.application_activities`);
    await pgQuery(`drop function if exists public.__jword_fail_activity()`);
    await pgQuery(`drop table if exists public.__jword_fail_flag`);
    await cleanupUsers();
    await closePg();
  });

  it("status update rolls back primary change, timestamps, and receipt when the activity insert fails", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "AtomCo", title: "SWE" },
      u.actor,
    );
    const id = created.applicationId!;
    const before = (await db.app(id))!;
    const requestId = rid();

    await pgQuery(`insert into public.__jword_fail_flag (user_id) values ($1)`, [u.id]);
    await expect(
      u.services.updateApplicationStatus(
        { requestId, applicationId: id, expectedVersion: 1, status: "APPLIED" },
        u.actor,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    const after = (await db.app(id))!;
    expect(after).toMatchObject({
      status: "SAVED",
      version: 1,
      applied_at: null,
      last_activity_at: before.last_activity_at,
    });
    expect(await db.activities(id)).toHaveLength(1);
    const receipts = await pgQuery(
      "select * from public.mutation_requests where user_id = $1 and request_id = $2",
      [u.id, requestId],
    );
    expect(receipts.rowCount).toBe(0);

    await pgQuery(`delete from public.__jword_fail_flag where user_id = $1`, [u.id]);
    const retry = await u.services.updateApplicationStatus(
      { requestId, applicationId: id, expectedVersion: 1, status: "APPLIED" },
      u.actor,
    );
    expect(retry).toMatchObject({ replayed: false, noop: false, version: 2 });
    expect(await db.activities(id)).toHaveLength(2);
  });

  it("import batch rolls back every row when a late activity insert fails", async () => {
    const existingApps = (await db.apps(u.id)).length;
    const existingCompanies = (await db.companies(u.id)).length;
    const existingJobs = (await db.jobs(u.id)).length;
    const requestId = rid();
    const rows = [
      {
        rowIndex: 1,
        company: "ImportFail One",
        title: "SWE",
        status: "APPLIED" as const,
        note: "n1",
      },
      { rowIndex: 2, company: "ImportFail Two", title: "SWE" },
      { rowIndex: 3, company: "ImportFail Three", title: "SWE" },
    ];

    await pgQuery(`insert into public.__jword_fail_flag (user_id) values ($1)`, [u.id]);
    await expect(u.services.commitImport({ requestId, rows }, u.actor)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    await pgQuery(`delete from public.__jword_fail_flag where user_id = $1`, [u.id]);

    expect((await db.apps(u.id)).length).toBe(existingApps);
    expect((await db.companies(u.id)).length).toBe(existingCompanies);
    expect((await db.jobs(u.id)).length).toBe(existingJobs);
    expect((await db.companies(u.id)).some((c) => c.name.startsWith("ImportFail"))).toBe(false);
    const receipts = await pgQuery(
      "select * from public.mutation_requests where user_id = $1 and request_id = $2",
      [u.id, requestId],
    );
    expect(receipts.rowCount).toBe(0);

    const ok = await u.services.commitImport({ requestId, rows }, u.actor);
    expect(ok).toMatchObject({ ok: true, replayed: false, imported: 3 });
    expect((await db.apps(u.id)).length).toBe(existingApps + 3);
    const firstId = ok.applicationIds![0]!;
    const activities = await db.activities(firstId);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: "IMPORTED", actor_type: "IMPORT" });
    const notes = await db.notes(firstId);
    expect(notes).toHaveLength(1);
    expect((activities[0]!.metadata as Record<string, unknown>).noteId).toBe(notes[0]!.id);
    expect((await db.app(firstId))!.applied_at).toBeNull();
  });
});
