import { afterAll, describe, expect, it } from "vitest";
import {
  createFixtureJobCollector,
  createTrackerServices,
  fixedClock,
  fixturePosting,
  SupabaseTrackerRepository,
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
} from "./helpers";

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});

const count = async (table: string, userId: string) =>
  (await pgQuery(`select count(*)::int n from ${table} where user_id=$1`, [userId])).rows[0].n;

describe("application deletion in the database (decision 025)", () => {
  it("deletes the application, job, notes, and history atomically; keeps the company", async () => {
    const owner = await createTestUser("app-delete");
    const app = await owner.services.createApplication(
      { requestId: rid(), company: "Delete Co", title: "Engineer", initialNote: "private note" },
      owner.actor,
    );
    await owner.services.updateApplicationStatus(
      { requestId: rid(), applicationId: app.applicationId, expectedVersion: 1, status: "APPLIED" },
      owner.actor,
    );
    const command = {
      requestId: rid(),
      applicationId: app.applicationId,
      expectedVersion: 2,
      confirmed: true,
    };
    await expectJwordError(
      owner.services.deleteApplication({ ...command, expectedVersion: 1 }, owner.actor),
      "CONFLICT",
      "STALE_VERSION",
    );
    expect(await count("applications", owner.id)).toBe(1);
    const deleted = await owner.services.deleteApplication(command, owner.actor);
    expect(deleted).toMatchObject({ deleted: true, replayed: false });
    for (const table of ["applications", "jobs", "application_notes", "application_activities"]) {
      expect(await count(table, owner.id), table).toBe(0);
    }
    expect(await count("companies", owner.id)).toBe(1);
    expect(await owner.services.deleteApplication(command, owner.actor)).toMatchObject({
      deleted: true,
      replayed: true,
    });
    await expectJwordError(
      owner.services.deleteApplication({ ...command, expectedVersion: 3 }, owner.actor),
      "CONFLICT",
      "REQUEST_ID_REUSED",
    );
    await expectJwordError(
      owner.services.deleteApplication({ ...command, requestId: rid() }, owner.actor),
      "NOT_FOUND",
      "APPLICATION_NOT_FOUND",
    );
  });

  it("returns a promoted lead to New in the same transaction", async () => {
    const owner = await createTestUser("app-delete-lead");
    const services = createTrackerServices({
      repository: new SupabaseTrackerRepository(owner.client),
      clock: fixedClock(TODAY),
      jobCollector: createFixtureJobCollector({
        GREENHOUSE: {
          "delete-leads": {
            status: "complete",
            reason: null,
            reportedTotal: null,
            postings: [
              fixturePosting("https://job-boards.greenhouse.io/delete-leads/jobs", "9", "Engineer"),
            ],
          },
        },
      }),
    });
    const watch = await services.addWatchedCompany(
      {
        requestId: rid(),
        company: "Delete Leads",
        boards: [{ provider: "GREENHOUSE", boardIdentifier: "delete-leads" }],
      },
      owner.actor,
    );
    await services.checkForNewJobs({ watchId: watch.watchId }, owner.actor);
    const [lead] = (await services.listLeads({}, owner.actor)).items;
    const promoted = await services.createApplicationFromLead(
      { requestId: rid(), leadId: lead!.leadId, expectedVersion: 1 },
      owner.actor,
    );
    const deletion = {
      requestId: rid(),
      applicationId: promoted.applicationId,
      expectedVersion: 1,
      confirmed: true,
    };
    // Failure after all deletes and lead restoration must still roll everything back.
    await pgQuery(`create function public.test_reject_application_delete_receipt() returns trigger language plpgsql as $$
      begin if new.user_id = '${owner.id}'::uuid and new.operation = 'delete_application'
      then raise exception 'receipt unavailable'; end if; return new; end $$;
      create trigger test_reject_application_delete_receipt before insert on public.mutation_requests
      for each row execute function public.test_reject_application_delete_receipt();`);
    try {
      await expect(services.deleteApplication(deletion, owner.actor)).rejects.toThrow();
      expect(await count("applications", owner.id)).toBe(1);
      expect(await count("jobs", owner.id)).toBe(1);
      expect(await count("application_activities", owner.id)).toBe(1);
      expect(await count("lead_activities", owner.id)).toBe(1);
      expect(await services.getLead({ leadId: lead!.leadId }, owner.actor)).toMatchObject({
        reviewStatus: "PROMOTED",
        applicationId: promoted.applicationId,
        version: 2,
      });
    } finally {
      await pgQuery(
        "drop trigger test_reject_application_delete_receipt on public.mutation_requests; drop function public.test_reject_application_delete_receipt();",
      );
    }
    await services.deleteApplication(deletion, owner.actor);
    expect(await services.deleteApplication(deletion, owner.actor)).toMatchObject({
      replayed: true,
    });
    const row = await pgQuery(
      "select review_status::text, application_id, version from leads where id=$1",
      [lead!.leadId],
    );
    expect(row.rows[0]).toEqual({ review_status: "NEW", application_id: null, version: 3 });
    const activity = await pgQuery(
      "select type::text from lead_activities where lead_id=$1 order by occurred_at",
      [lead!.leadId],
    );
    expect(activity.rows.map((r) => r.type)).toEqual(["LEAD_PROMOTED", "LEAD_RESTORED"]);
    expect(
      await services.createApplicationFromLead(
        {
          requestId: rid(),
          leadId: lead!.leadId,
          expectedVersion: 3,
        },
        owner.actor,
      ),
    ).toMatchObject({ reviewStatus: "PROMOTED", version: 4 });
  });

  it("validates direct calls and never deletes another owner's application", async () => {
    const owner = await createTestUser("app-delete-owner");
    const other = await createTestUser("app-delete-other");
    const app = await owner.services.createApplication(
      { requestId: rid(), company: "Mine", title: "Engineer" },
      owner.actor,
    );
    const call = (client: typeof owner.client, ownerId: string, command: Record<string, unknown>) =>
      client.rpc("delete_application", {
        p_owner_id: ownerId,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: command as Json,
      });
    const base = { applicationId: app.applicationId, expectedVersion: 1 };
    expect((await call(owner.client, owner.id, { ...base, confirmed: false })).error?.hint).toBe(
      "CONFIRMATION_REQUIRED",
    );
    expect((await call(owner.client, owner.id, base)).error?.code).toBe("JW422");
    expect((await call(other.client, other.id, { ...base, confirmed: true })).error?.hint).toBe(
      "APPLICATION_NOT_FOUND",
    );
    expect((await call(other.client, owner.id, { ...base, confirmed: true })).error?.hint).toBe(
      "OWNER_MISMATCH",
    );
    expect((await call(anonClient(), owner.id, { ...base, confirmed: true })).error).not.toBeNull();
    const direct = await owner.client.from("applications").delete().eq("id", app.applicationId!);
    expect(await count("applications", owner.id)).toBe(1);
    expect(direct.error === null || /permission denied/i.test(direct.error.message)).toBe(true);
  });
});
