import { afterAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createTestUser, cleanupUsers, closePg, pgQuery, rid } from "./helpers";
import { watchBoardContract } from "../fixtures/watch-board-contract";
import type { Json } from "@jword/core";

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});
async function connection() {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  await client.query("set statement_timeout = '8s'");
  const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid as number;
  return { client, pid };
}
const call = (
  client: pg.Client,
  owner: string,
  fn: "create_company_watch" | "update_company_watch",
  command: unknown,
) =>
  client.query(`select public.${fn}($1,'USER',$2,$3::jsonb) result`, [
    owner,
    rid(),
    JSON.stringify(command),
  ]);

describe("watchlist review database regressions", () => {
  it("matches the shared TypeScript/SQL board-validation contract", async () => {
    const owner = await createTestUser("review-contract");
    for (const item of watchBoardContract) {
      const { error } = await owner.client.rpc("create_company_watch", {
        p_owner_id: owner.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: { company: item.name, boards: item.boards } as Json,
      });
      if (item.valid) expect(error, item.name).toBeNull();
      else expect(error?.code, item.name).toBe("JW422");
    }
  });
  it("preserves board IDs through reorder and addition, and rejects duplicate URLs through RPC", async () => {
    const owner = await createTestUser("review-stable");
    const boards = [
      { provider: "LEVER", boardIdentifier: "one" },
      { provider: "ASHBY", boardIdentifier: "two" },
    ];
    const watch = await owner.services.addWatchedCompany(
      { requestId: rid(), company: "Stable", boards },
      owner.actor,
    );
    const rows = async () =>
      (
        await pgQuery(
          "select id, board_identifier, created_at, position from company_watch_boards where watch_id=$1 order by position",
          [watch.watchId],
        )
      ).rows;
    const before = await rows();
    await owner.services.updateWatchedCompany(
      {
        requestId: rid(),
        watchId: watch.watchId,
        expectedVersion: 1,
        boards: [boards[1], boards[0], { provider: "GREENHOUSE", boardIdentifier: "three" }],
      },
      owner.actor,
    );
    const after = await rows();
    expect(after[0]).toEqual({ ...before[1], position: 1 });
    expect(after[1]).toEqual({ ...before[0], position: 2 });
    const { error } = await owner.client.rpc("update_company_watch", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: {
        watchId: watch.watchId,
        expectedVersion: 2,
        boards: [
          { provider: "LEVER", boardIdentifier: "one" },
          { provider: "OTHER", boardUrl: "https://jobs.lever.co/one" },
        ],
      },
    });
    expect(error?.hint).toBe("DUPLICATE_BOARD");
    expect(await rows()).toEqual(after);
    const audit = await pgQuery(
      "select metadata from company_watch_activities where watch_id=$1 and type='WATCH_UPDATED'",
      [watch.watchId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.boardsBefore).toHaveLength(2);
    expect(audit.rows[0].metadata.boardsAfter).toHaveLength(3);
  });

  it.each(["create", "update"] as const)(
    "returns BOARD_ALREADY_WATCHED for a concurrent %s board claim",
    async (operation) => {
      const owner = await createTestUser(`review-race-${operation}`);
      const existing =
        operation === "update"
          ? await owner.services.addWatchedCompany(
              { requestId: rid(), company: "Loser" },
              owner.actor,
            )
          : null;
      const a = await connection();
      const b = await connection();
      let contender: Promise<unknown> | undefined;
      try {
        await a.client.query("begin");
        const board = { provider: "LEVER", boardIdentifier: "claimed" };
        await call(a.client, owner.id, "create_company_watch", {
          company: "Winner",
          boards: [board],
        });
        contender = call(
          b.client,
          owner.id,
          existing ? "update_company_watch" : "create_company_watch",
          existing
            ? { watchId: existing.watchId, expectedVersion: 1, boards: [board] }
            : { company: "Loser", boards: [board] },
        ).catch((e) => e);
        await vi.waitFor(async () => {
          const result = await pgQuery("select $1 = any(pg_blocking_pids($2)) blocked", [
            a.pid,
            b.pid,
          ]);
          expect(result.rows[0].blocked).toBe(true);
        });
        await a.client.query("commit");
        const error = await contender;
        expect(error).toMatchObject({ code: "JW409", hint: "BOARD_ALREADY_WATCHED" });
        if (existing)
          expect(
            (await owner.services.getWatchedCompany({ watchId: existing.watchId }, owner.actor))
              .watch,
          ).toMatchObject({ version: 1, boards: [] });
      } finally {
        await a.client.query("rollback");
        await contender;
        await a.client.end();
        await b.client.end();
      }
    },
  );

  it("a duplicate add and an edit do not deadlock over opposite row lock order", async () => {
    const owner = await createTestUser("review-locks");
    const watch = await owner.services.addWatchedCompany(
      { requestId: rid(), company: "Lock order" },
      owner.actor,
    );
    const a = await connection();
    const b = await connection();
    let edit: Promise<pg.QueryResult> | undefined;
    try {
      await a.client.query("begin");
      await a.client.query("select id from companies where id=$1 for update", [watch.companyId]);
      edit = call(b.client, owner.id, "update_company_watch", {
        watchId: watch.watchId,
        expectedVersion: 1,
        interestLevel: 4,
      });
      // Observe the actual lock wait rather than relying on a timing sleep.
      await vi.waitFor(async () => {
        const result = await pgQuery("select $1 = any(pg_blocking_pids($2)) blocked", [
          a.pid,
          b.pid,
        ]);
        expect(result.rows[0].blocked).toBe(true);
      });
      await expect(
        call(a.client, owner.id, "create_company_watch", { companyId: watch.companyId }),
      ).rejects.toMatchObject({ hint: "ALREADY_WATCHED" });
      await a.client.query("rollback");
      expect((await edit).rows[0].result.version).toBe(2);
    } finally {
      await a.client.query("rollback");
      await edit?.catch(() => {});
      await a.client.end();
      await b.client.end();
    }
  });
});
