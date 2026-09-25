import { afterAll, describe, expect, it } from "vitest";
import type { Json } from "@jword/core";
import {
  anonClient,
  cleanupUsers,
  closePg,
  createTestUser,
  db,
  expectJwordError,
  pgQuery,
  rid,
} from "./helpers";

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});

describe("confirmed watch deletion", () => {
  it.each([true, false])(
    "deletes an active=%s watch, retains audit and applications, and safely replays after re-add",
    async (active) => {
      const owner = await createTestUser(`delete-${active}`);
      const application = await owner.services.createApplication(
        { requestId: rid(), company: "Keep company", title: "Engineer" },
        owner.actor,
      );
      const boards = [{ provider: "LEVER", boardIdentifier: "keep-company" }];
      let watch = await owner.services.addWatchedCompany(
        {
          requestId: rid(),
          companyId: application.companyId,
          companyNotes: "Keep these notes",
          boards,
        },
        owner.actor,
      );
      if (!active)
        watch = await owner.services.setCompanyWatchStatus(
          {
            requestId: rid(),
            watchId: watch.watchId,
            expectedVersion: watch.version,
            active: false,
          },
          owner.actor,
        );
      const command = {
        requestId: rid(),
        watchId: watch.watchId,
        expectedVersion: watch.version,
        confirmed: true,
      };
      const result = await owner.services.deleteWatchedCompany(command, owner.actor);
      expect(result).toMatchObject({
        deleted: true,
        watchId: watch.watchId,
        version: watch.version + 1,
        replayed: false,
      });
      expect(
        (await pgQuery("select id from company_watches where id=$1", [watch.watchId])).rows,
      ).toHaveLength(0);
      expect(
        (await pgQuery("select id from company_watch_boards where watch_id=$1", [watch.watchId]))
          .rows,
      ).toHaveLength(0);
      expect((await owner.services.listWatchedCompanies({}, owner.actor)).items).toHaveLength(0);
      expect(application.applicationId).toBeDefined();
      expect(await db.app(application.applicationId!)).not.toBeNull();
      expect((await db.companies(owner.id))[0]).toMatchObject({
        id: application.companyId,
        notes: "Keep these notes",
      });
      const audit = await owner.client
        .from("company_watch_activities")
        .select("*")
        .eq("original_watch_id", watch.watchId);
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(active ? 2 : 3);
      expect(audit.data?.every((a) => a.watch_id === null && a.user_id === owner.id)).toBe(true);
      expect(audit.data?.find((a) => a.type === "WATCH_DELETED")).toMatchObject({
        id: result.activityId,
        metadata: {
          companyId: application.companyId,
          boardsBefore: [{ provider: "LEVER", boardIdentifier: "keep-company" }],
        },
      });
      const replacement = await owner.services.addWatchedCompany(
        { requestId: rid(), companyId: application.companyId, boards },
        owner.actor,
      );
      expect(replacement.watchId).not.toBe(watch.watchId);
      expect(await owner.services.deleteWatchedCompany(command, owner.actor)).toMatchObject({
        replayed: true,
        watchId: watch.watchId,
      });
      expect(
        (await owner.services.getWatchedCompany({ watchId: replacement.watchId }, owner.actor))
          .watch.boards,
      ).toHaveLength(1);
      await expectJwordError(
        owner.services.deleteWatchedCompany(
          { ...command, watchId: replacement.watchId },
          owner.actor,
        ),
        "CONFLICT",
        "REQUEST_ID_REUSED",
      );
      expect(
        (await db.receipts(owner.id)).filter((r) => r.operation === "delete_company_watch"),
      ).toHaveLength(1);
      await expectJwordError(
        owner.services.setCompanyWatchStatus(
          {
            requestId: rid(),
            watchId: watch.watchId,
            expectedVersion: result.version,
            active: true,
          },
          owner.actor,
        ),
        "NOT_FOUND",
        "WATCH_NOT_FOUND",
      );
    },
  );

  it("rejects stale, foreign, unconfirmed and malformed direct RPC requests and keeps archived audit owner-scoped", async () => {
    const owner = await createTestUser("delete-owner");
    const other = await createTestUser("delete-other");
    const watch = await owner.services.addWatchedCompany(
      { requestId: rid(), company: "Private watch" },
      owner.actor,
    );
    const command = { watchId: watch.watchId, expectedVersion: 1, confirmed: true };
    await expectJwordError(
      other.services.deleteWatchedCompany({ ...command, requestId: rid() }, other.actor),
      "NOT_FOUND",
    );
    await expectJwordError(
      owner.services.deleteWatchedCompany(
        { ...command, requestId: rid(), expectedVersion: 2 },
        owner.actor,
      ),
      "CONFLICT",
      "STALE_VERSION",
    );
    for (const input of [
      { watchId: watch.watchId, expectedVersion: 1 },
      { ...command, confirmed: false },
      { ...command, confirmed: "true" },
      { ...command, unexpected: true },
      { ...command, expectedVersion: null },
    ]) {
      const { error } = await owner.client.rpc("delete_company_watch", {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: input as Json,
      });
      expect(error?.code).toBe("JW422");
    }
    const spoof = await other.client.rpc("delete_company_watch", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: command,
    });
    expect(spoof.error).not.toBeNull();
    const anonymous = await anonClient().rpc("delete_company_watch", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: command,
    });
    expect(anonymous.error).not.toBeNull();
    // Authenticated clients cannot bypass the confirmation/version/audit wrapper with table writes.
    const direct = await owner.client.from("company_watches").delete().eq("id", watch.watchId);
    expect(direct.error).not.toBeNull();
    expect(
      (await owner.services.getWatchedCompany({ watchId: watch.watchId }, owner.actor)).watch
        .version,
    ).toBe(1);
    await owner.services.deleteWatchedCompany({ ...command, requestId: rid() }, owner.actor);
    const foreignAudit = await other.client
      .from("company_watch_activities")
      .select("*")
      .eq("original_watch_id", watch.watchId);
    expect(foreignAudit.error).toBeNull();
    expect(foreignAudit.data).toEqual([]);
  });

  it("rolls back deletion when its audit record cannot be written", async () => {
    const owner = await createTestUser("delete-atomic");
    const watch = await owner.services.addWatchedCompany(
      {
        requestId: rid(),
        company: "Atomic",
        boards: [{ provider: "ASHBY", boardIdentifier: "atomic" }],
      },
      owner.actor,
    );
    // Owner-scoped fault injection; other integration tests can continue using the table.
    await pgQuery(`create function public.test_reject_watch_deletion() returns trigger language plpgsql as $$
      begin if new.user_id = '${owner.id}'::uuid and new.type = 'WATCH_DELETED' then raise exception 'audit unavailable'; end if; return new; end $$;
      create trigger test_reject_watch_deletion before insert on public.company_watch_activities for each row execute function public.test_reject_watch_deletion();`);
    const command = {
      requestId: rid(),
      watchId: watch.watchId,
      expectedVersion: 1,
      confirmed: true,
    };
    try {
      await expect(owner.services.deleteWatchedCompany(command, owner.actor)).rejects.toThrow();
      const current = await owner.services.getWatchedCompany(
        { watchId: watch.watchId },
        owner.actor,
      );
      expect(current.watch).toMatchObject({ version: 1, boards: [{ boardIdentifier: "atomic" }] });
      expect(current.activity.items).toHaveLength(1);
      expect((await db.receipts(owner.id)).some((r) => r.request_id === command.requestId)).toBe(
        false,
      );
    } finally {
      await pgQuery(
        "drop trigger test_reject_watch_deletion on public.company_watch_activities; drop function public.test_reject_watch_deletion();",
      );
    }
    expect(await owner.services.deleteWatchedCompany(command, owner.actor)).toMatchObject({
      deleted: true,
      replayed: false,
    });
  });
});
