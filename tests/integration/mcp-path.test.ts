import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  closePg,
  createTestUser,
  db,
  expectJwordError,
  mcpServicesFor,
  rid,
  type TestUser,
} from "./helpers";

describe("MCP path: service-role client locked to one owner", () => {
  let a: TestUser;
  let b: TestUser;
  let bApplicationId: string;

  beforeAll(async () => {
    a = await createTestUser("mcp-a");
    b = await createTestUser("mcp-b");
    await a.services.createApplication(
      { requestId: rid(), company: "Alpha", title: "SWE" },
      a.actor,
    );
    await a.services.createApplication(
      { requestId: rid(), company: "Alpha", title: "SRE", status: "APPLIED" },
      a.actor,
    );
    const bApp = await b.services.createApplication(
      { requestId: rid(), company: "Beta", title: "SWE" },
      b.actor,
    );
    bApplicationId = bApp.applicationId!;
  });

  afterAll(async () => {
    await cleanupUsers();
    await closePg();
  });

  it("reads only the configured owner's rows even though RLS is bypassed", async () => {
    const { services, actor } = mcpServicesFor(a.id);
    const page = await services.searchApplications({ limit: 25 }, actor);
    expect(page.items.length).toBe(2);
    expect(page.items.every((i) => i.company === "Alpha")).toBe(true);
    const search = await services.searchApplications({ text: "Beta" }, actor);
    expect(search.items).toEqual([]);
  });

  it("cannot read or mutate another user's application by a valid UUID", async () => {
    const { services, actor } = mcpServicesFor(a.id);
    await expectJwordError(
      services.getApplication({ applicationId: bApplicationId }, actor),
      "NOT_FOUND",
    );
    await expectJwordError(
      services.updateApplicationStatus(
        { requestId: rid(), applicationId: bApplicationId, expectedVersion: 1, status: "REJECTED" },
        actor,
      ),
      "NOT_FOUND",
    );
    const row = await db.app(bApplicationId);
    expect(row?.status).toBe("SAVED");
    expect(row?.version).toBe(1);
    expect(await db.activities(bApplicationId)).toHaveLength(1);
  });

  it("records CODEX as the actor and the pipeline summary is deterministic", async () => {
    const { services, actor } = mcpServicesFor(a.id);
    const page = await services.searchApplications({ text: "SRE" }, actor);
    const target = page.items[0]!;
    const result = await services.updateApplicationStatus(
      {
        requestId: rid(),
        applicationId: target.applicationId,
        expectedVersion: target.version,
        status: "OA",
      },
      actor,
    );
    expect(result.ok).toBe(true);
    const activities = await db.activities(target.applicationId);
    expect(activities.at(-1)).toMatchObject({ type: "STATUS_CHANGED", actor_type: "CODEX" });

    const summary = await services.getPipelineSummary({}, actor);
    expect(summary.total).toBe(2);
    expect(summary.byStatus.SAVED).toBe(1);
    expect(summary.byStatus.OA).toBe(1);
    expect(summary.active).toBe(2);
  });
});
