import { afterAll, beforeAll, expect, it } from "vitest";
import {
  adminClient,
  cleanupUsers,
  closePg,
  createTestUser,
  pgQuery,
  rid,
  type TestUser,
} from "./helpers";

/**
 * Account deletion (decision 027): deleting the auth user removes every row the user owns,
 * because every user_id references auth.users with on delete cascade. The privacy page relies on
 * this, so the test discovers the tables from the catalog instead of listing them.
 */

let leaving: TestUser;
let staying: TestUser;

async function ownedRowCounts(userId: string): Promise<Record<string, number>> {
  const { rows } = await pgQuery<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
      order by 1`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of rows) {
    const result = await pgQuery<{ n: number }>(
      `select count(*)::int as n from public.${table_name} where user_id = $1`,
      [userId],
    );
    counts[table_name] = result.rows[0]!.n;
  }
  return counts;
}

beforeAll(async () => {
  leaving = await createTestUser("delete-leaving");
  staying = await createTestUser("delete-staying");
  for (const user of [leaving, staying]) {
    await user.services.createApplication(
      { requestId: rid(), company: "Cascade Co", title: "Engineer", initialNote: "a note" },
      user.actor,
    );
    await user.services.saveCandidateProfile({ fullName: "Test Person" }, user.actor);
  }
});

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});

it("deleting a user removes all of their rows and none of anyone else's", async () => {
  const before = await ownedRowCounts(leaving.id);
  expect(Object.keys(before).length).toBeGreaterThanOrEqual(16);
  expect(before.applications).toBe(1);
  expect(before.application_notes).toBe(1);
  expect(before.candidate_profiles).toBe(1);
  const otherBefore = await ownedRowCounts(staying.id);

  const { error } = await adminClient().auth.admin.deleteUser(leaving.id);
  expect(error).toBeNull();

  const after = await ownedRowCounts(leaving.id);
  expect(Object.values(after).every((n) => n === 0)).toBe(true);
  expect(await ownedRowCounts(staying.id)).toEqual(otherBefore);
});
