import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseTrackerRepository } from "@jword/core";
import { cleanupUsers, createTestUser, rid, type TestUser } from "./helpers";

describe("reads beyond the PostgREST row cap", () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await createTestUser("pagination");
  });
  afterAll(cleanupUsers);
  it("counts and duplicate preview include every owner record beyond 1000 rows", async () => {
    for (let offset = 0; offset < 1001; offset += 100) {
      await user.services.commitImport(
        {
          requestId: rid(),
          rows: Array.from({ length: Math.min(100, 1001 - offset) }, (_, i) => ({
            rowIndex: i + 1,
            company: "Pagination",
            title: `Role ${offset + i}`,
          })),
        },
        user.actor,
      );
    }
    const counts = await user.services.getStatusCounts(user.actor);
    expect(counts.total).toBe(1001);
    const repository = new SupabaseTrackerRepository(user.client);
    const index = await repository.listDuplicateIndex(user.id);
    expect(index).toHaveLength(1001);
    expect(new Set(index.map((entry) => entry.applicationId)).size).toBe(1001);
    expect(index.some((entry) => entry.title === "Role 1000")).toBe(true);
  }, 60_000);
});
