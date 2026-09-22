import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  cleanupUsers,
  closePg,
  createTestUser,
  expectJwordError,
  pgQuery,
  rid,
  type TestUser,
} from "./helpers";

describe("Row Level Security and write boundary", () => {
  let owner: TestUser;
  let other: TestUser;
  let applicationId: string;

  beforeAll(async () => {
    owner = await createTestUser("rls-owner");
    other = await createTestUser("rls-other");
    const created = await owner.services.createApplication(
      { requestId: rid(), company: "RLS Corp", title: "Engineer", initialNote: "secret note" },
      owner.actor,
    );
    applicationId = created.applicationId!;
  });

  afterAll(async () => {
    await cleanupUsers();
    await closePg();
  });

  it("owner reads own rows through every exposed table and the view", async () => {
    const overview = await owner.client.from("application_overview").select("application_id");
    expect(overview.error).toBeNull();
    expect(overview.data?.map((r) => r.application_id)).toContain(applicationId);
    for (const table of ["applications", "application_notes", "application_activities"] as const) {
      const { data, error } = await owner.client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data?.length, table).toBeGreaterThan(0);
    }
  });

  it("another authenticated user sees nothing and gets NOT_FOUND", async () => {
    for (const table of [
      "applications",
      "application_notes",
      "application_activities",
      "companies",
      "jobs",
    ] as const) {
      const { data, error } = await other.client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    const view = await other.client.from("application_overview").select("*");
    expect(view.data).toEqual([]);
    await expectJwordError(
      other.services.getApplication({ applicationId }, other.actor),
      "NOT_FOUND",
    );
    await expectJwordError(
      other.services.updateApplicationStatus(
        { requestId: rid(), applicationId, expectedVersion: 1, status: "APPLIED" },
        other.actor,
      ),
      "NOT_FOUND",
    );
  });

  it("anonymous clients cannot read or mutate", async () => {
    const anon = anonClient();
    for (const table of ["applications", "companies"] as const) {
      const { error } = await anon.from(table).select("*");
      expect(error?.code, table).toBe("42501");
    }
    const rpc = await anon.rpc("create_application", {
      p_owner_id: owner.id,
      p_actor: "USER",
      p_request_id: rid(),
      p_command: { company: "X", title: "Y" },
    });
    expect(rpc.error).not.toBeNull();
    expect(rpc.error?.code).toBe("42501");
  });

  it("authenticated direct table writes are denied even for the owner's rows", async () => {
    const denied = (error: { code?: string; message?: string } | null) =>
      error !== null && (error.code === "42501" || /permission denied/i.test(error.message ?? ""));

    const insertCompany = await owner.client
      .from("companies")
      .insert({ user_id: owner.id, name: "Direct", normalized_name: "direct" });
    expect(denied(insertCompany.error)).toBe(true);

    const update = await owner.client
      .from("applications")
      .update({ priority: "HIGH" })
      .eq("id", applicationId);
    expect(denied(update.error)).toBe(true);

    const del = await owner.client.from("applications").delete().eq("id", applicationId);
    expect(denied(del.error)).toBe(true);

    const forged = await owner.client.from("application_activities").insert({
      user_id: owner.id,
      application_id: applicationId,
      type: "CREATED",
      actor_type: "USER",
      summary: "forged",
    });
    expect(denied(forged.error)).toBe(true);

    const receipts = await owner.client.from("mutation_requests").select("*");
    expect(denied(receipts.error)).toBe(true);

    const { data: app } = await owner.client
      .from("applications")
      .select("priority, version")
      .eq("id", applicationId)
      .single();
    expect(app).toEqual({ priority: "MEDIUM", version: 1 });
  });

  it("owner session cannot execute a function scoped to a different owner id", async () => {
    // Same session client, actor claims to be the other user: resolve_owner must reject.
    const error = await expectJwordError(
      owner.services.updateApplicationDetails(
        { requestId: rid(), applicationId, expectedVersion: 1, priority: "HIGH" },
        { userId: other.id, actorType: "USER" },
      ),
      "FORBIDDEN",
      "OWNER_MISMATCH",
    );
    expect(error.message).toMatch(/owner/i);
    const { data: app } = await owner.client
      .from("applications")
      .select("priority, version")
      .eq("id", applicationId)
      .single();
    expect(app).toEqual({ priority: "MEDIUM", version: 1 });
  });

  it("composite foreign keys reject cross-owner links at the database boundary", async () => {
    const otherCompany = await pgQuery<{ id: string }>(
      "insert into public.companies (user_id, name, normalized_name) values ($1, 'Other Co', 'other co') returning id",
      [other.id],
    );
    const otherCompanyId = otherCompany.rows[0]!.id;

    await expect(
      pgQuery(
        "insert into public.jobs (user_id, company_id, title, normalized_title) values ($1, $2, 'X', 'x')",
        [owner.id, otherCompanyId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    const ownerJob = await pgQuery<{ job_id: string }>(
      "select job_id from public.applications where id = $1",
      [applicationId],
    );
    await expect(
      pgQuery("insert into public.applications (user_id, job_id) values ($1, $2)", [
        other.id,
        ownerJob.rows[0]!.job_id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      pgQuery(
        "insert into public.application_notes (user_id, application_id, body) values ($1, $2, 'x')",
        [other.id, applicationId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      pgQuery(
        "insert into public.application_activities (user_id, application_id, type, actor_type, summary) values ($1, $2, 'CREATED', 'USER', 'x')",
        [other.id, applicationId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
