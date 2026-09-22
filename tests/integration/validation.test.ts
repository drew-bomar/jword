import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@jword/core";
import { cleanupUsers, createTestUser, db, rid, type TestUser } from "./helpers";

describe("direct RPC validation", () => {
  let user: TestUser;
  beforeAll(async () => {
    user = await createTestUser("validation");
  });
  afterAll(cleanupUsers);

  it("rejects unknown keys, wrong JSON types, oversized text and unsafe URLs before writing", async () => {
    const invalid: Json[] = [
      null,
      [],
      { company: "Acme", title: "Engineer", extra: true },
      { company: 42, title: "Engineer" },
      { company: "Acme", title: "x".repeat(201) },
      { company: "Acme", title: "Engineer", jobUrl: "javascript:alert(1)" },
      { company: "Acme", title: "Engineer", status: null },
      { company: "Acme", title: "Engineer", allowDuplicate: "true" },
      { company: "Acme", title: "Engineer", dateFound: "2026-02-30" },
    ];
    for (const command of invalid) {
      const { error } = await user.client.rpc("create_application", {
        p_owner_id: user.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: command,
      });
      expect(error?.code, JSON.stringify(command)).toBe("JW422");
    }
    expect(await db.apps(user.id)).toHaveLength(0);
    expect(await db.receipts(user.id)).toHaveLength(0);
  });

  it("validates every imported row and profile fields through the direct database boundary", async () => {
    const { error } = await user.client.rpc("import_applications", {
      p_owner_id: user.id,
      p_actor: "IMPORT",
      p_request_id: rid(),
      p_command: {
        rows: [
          { rowIndex: 1, company: "Good", title: "Engineer" },
          { rowIndex: 2, company: "Bad", title: "Engineer", jobUrl: "file:///private" },
        ],
      },
    });
    expect(error?.code).toBe("JW422");
    expect(await db.apps(user.id)).toHaveLength(0);
    const profile = await user.client.rpc("save_candidate_profile", {
      p_owner_id: user.id,
      p_command: { linkedinUrl: "javascript:alert(1)" },
    });
    expect(profile.error?.code).toBe("JW422");
  });

  it("matches shared profile validation for malformed emails and wrong types", async () => {
    for (const email of [
      "a.@example.com",
      "a@-example.com",
      " a@example.com ",
      "a..b@example.com",
    ]) {
      const { error } = await user.client.rpc("save_candidate_profile", {
        p_owner_id: user.id,
        p_command: { email },
      });
      expect(error?.code, email).toBe("JW422");
    }
  });

  it("rejects invalid direct edits without changing the application or its history", async () => {
    const created = await user.services.createApplication(
      { requestId: rid(), company: "Valid", title: "Engineer" },
      user.actor,
    );
    for (const extra of [
      { jobUrl: "ftp://bad" },
      { location: "x".repeat(201) },
      { priority: null },
    ]) {
      const { error } = await user.client.rpc("update_application_details", {
        p_owner_id: user.id,
        p_actor: "USER",
        p_request_id: rid(),
        p_command: { applicationId: created.applicationId!, expectedVersion: 1, ...extra },
      });
      expect(error?.code).toBe("JW422");
    }
    expect((await db.app(created.applicationId!))?.version).toBe(1);
    expect(await db.activities(created.applicationId!)).toHaveLength(1);
  });
});
