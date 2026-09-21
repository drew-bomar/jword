import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, OTHER_ID, OWNER_ID, type Harness } from "./helpers";

const READ_TOOLS = [
  "search_applications",
  "get_application",
  "list_application_activity",
  "get_pipeline_summary",
];
const MUTATION_TOOLS = [
  "create_application",
  "update_application_status",
  "update_application_details",
  "add_application_note",
  "update_application_note",
];

describe("jword MCP tools", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it("lists exactly the nine approved tools with correct annotations and strict schemas", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...MUTATION_TOOLS].sort());
    for (const tool of tools) {
      const readOnly = READ_TOOLS.includes(tool.name);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(readOnly);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      expect(
        (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties,
        tool.name,
      ).toBe(false);
    }
  });

  describe("input validation (no mutation on rejection)", () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      [
        "invalid UUID",
        "update_application_status",
        { requestId: "not-a-uuid", applicationId: "also-not", expectedVersion: 1, status: "OA" },
      ],
      [
        "invalid enum",
        "update_application_status",
        {
          requestId: crypto.randomUUID(),
          applicationId: crypto.randomUUID(),
          expectedVersion: 1,
          status: "GHOSTED",
        },
      ],
      [
        "malformed date",
        "create_application",
        { requestId: crypto.randomUUID(), company: "IBM", title: "SWE", appliedAt: "09/21/2026" },
      ],
      [
        "unknown field",
        "create_application",
        { requestId: crypto.randomUUID(), company: "IBM", title: "SWE", version: 5 },
      ],
      [
        "unknown field on note",
        "add_application_note",
        {
          requestId: crypto.randomUUID(),
          applicationId: crypto.randomUUID(),
          expectedVersion: 1,
          note: "hi",
          userId: OTHER_ID,
        },
      ],
    ];
    for (const [label, tool, args] of cases) {
      it(`rejects ${label}`, async () => {
        const before = h.repo.applications.length + h.repo.activities.length;
        const result = await h.client
          .callTool({ name: tool, arguments: args })
          .catch((error: Error) => error);
        if (result instanceof Error) {
          expect(result.message).toMatch(/invalid|expected|unrecognized/i);
        } else {
          const r = result as {
            isError?: boolean;
            content: Array<{ type: string; text?: string }>;
          };
          expect(r.isError).toBe(true);
          expect(r.content[0]?.text).toMatch(/VALIDATION_ERROR|Invalid/);
        }
        expect(h.repo.applications.length + h.repo.activities.length).toBe(before);
      });
    }

    it("rejects an empty details update", async () => {
      const seeded = await h.seed(OWNER_ID, { company: "Ramp", title: "Backend Engineer" });
      const { raw, body } = await h.call("update_application_details", {
        requestId: crypto.randomUUID(),
        applicationId: seeded.applicationId,
        expectedVersion: 1,
      });
      expect(raw.isError).toBe(true);
      expect(body.ok).toBe(false);
      expect((body.error as { code: string }).code).toBe("VALIDATION_ERROR");
      expect(h.repo.activities).toHaveLength(1);
    });

    it("caps search limit at 25", async () => {
      const result = await h.client
        .callTool({ name: "search_applications", arguments: { limit: 100 } })
        .catch((e: Error) => e);
      if (result instanceof Error) expect(result.message).toMatch(/invalid|too big|<=25|maximum/i);
      else expect((result as { isError?: boolean }).isError).toBe(true);
    });
  });

  describe("owner scoping", () => {
    it("cannot read or mutate another user's application even with its real UUID", async () => {
      const foreign = await h.seed(OTHER_ID, { company: "Stripe", title: "Platform Engineer" });
      const get = await h.call("get_application", { applicationId: foreign.applicationId });
      expect(get.raw.isError).toBe(true);
      expect((get.body.error as { code: string }).code).toBe("NOT_FOUND");

      const activitiesBefore = h.repo.activities.length;
      const update = await h.call("update_application_status", {
        requestId: crypto.randomUUID(),
        applicationId: foreign.applicationId,
        expectedVersion: 1,
        status: "REJECTED",
      });
      expect(update.raw.isError).toBe(true);
      expect((update.body.error as { code: string }).code).toBe("NOT_FOUND");
      expect(h.repo.activities.length).toBe(activitiesBefore);
      expect(h.repo.applications.find((a) => a.id === foreign.applicationId)?.status).toBe("SAVED");

      const search = await h.call("search_applications", { text: "Stripe" });
      expect(search.body.count).toBe(0);
    });
  });

  describe("mutations", () => {
    it("unique status update succeeds and records a CODEX activity", async () => {
      const seeded = await h.seed(OWNER_ID, {
        company: "Datadog",
        title: "Backend Engineer",
        status: "APPLIED",
      });
      const requestId = crypto.randomUUID();
      const { raw, body } = await h.call("update_application_status", {
        requestId,
        applicationId: seeded.applicationId,
        expectedVersion: 1,
        status: "INTERVIEW",
      });
      expect(raw.isError).toBeFalsy();
      expect(body).toMatchObject({
        ok: true,
        operation: "update_application_status",
        requestId,
        replayed: false,
        noop: false,
        applicationId: seeded.applicationId,
        version: 2,
        changedFields: ["status"],
        before: { status: "APPLIED" },
        after: { status: "INTERVIEW" },
      });
      expect(typeof body.activityId).toBe("string");
      const activity = h.repo.activities.find((a) => a.activityId === body.activityId);
      expect(activity).toMatchObject({ type: "STATUS_CHANGED", actorType: "CODEX" });

      const replay = await h.call("update_application_status", {
        requestId,
        applicationId: seeded.applicationId,
        expectedVersion: 1,
        status: "INTERVIEW",
      });
      expect(replay.body).toMatchObject({ ok: true, replayed: true, version: 2 });
      expect(h.repo.activities.filter((a) => a.type === "STATUS_CHANGED")).toHaveLength(1);
    });

    it("stale version returns CONFLICT/STALE_VERSION and changes nothing", async () => {
      const seeded = await h.seed(OWNER_ID, { company: "Garmin", title: "Software Engineer" });
      await h.call("add_application_note", {
        requestId: crypto.randomUUID(),
        applicationId: seeded.applicationId,
        expectedVersion: 1,
        note: "Finished the HireVue",
      });
      const activities = h.repo.activities.length;
      const { raw, body } = await h.call("update_application_status", {
        requestId: crypto.randomUUID(),
        applicationId: seeded.applicationId,
        expectedVersion: 1,
        status: "OA",
      });
      expect(raw.isError).toBe(true);
      expect(body.error).toMatchObject({
        code: "CONFLICT",
        reason: "STALE_VERSION",
        currentVersion: 2,
        expectedVersion: 1,
      });
      expect(h.repo.activities.length).toBe(activities);
      expect(h.repo.applications[0]?.status).toBe("SAVED");
    });

    it("duplicate create returns CONFLICT with candidates and creates nothing", async () => {
      await h.seed(OWNER_ID, { company: "IBM", title: "Software Engineer" });
      const { raw, body } = await h.call("create_application", {
        requestId: crypto.randomUUID(),
        company: "ibm",
        title: "software  engineer",
      });
      expect(raw.isError).toBe(true);
      const error = body.error as {
        code: string;
        reason: string;
        candidates: Array<{ company: string }>;
      };
      expect(error.code).toBe("CONFLICT");
      expect(error.reason).toBe("DUPLICATE_CANDIDATES");
      expect(error.candidates).toHaveLength(1);
      expect(error.candidates[0]?.company).toBe("IBM");
      expect(h.repo.applications).toHaveLength(1);
    });

    it("create applies today defaults and note results never include note text", async () => {
      const { body } = await h.call("create_application", {
        requestId: crypto.randomUUID(),
        company: "Ramp",
        title: "Backend Engineer",
        status: "APPLIED",
        initialNote: "secret note body",
      });
      expect(body).toMatchObject({
        ok: true,
        after: { appliedAt: "2026-09-21", dateFound: "2026-09-21" },
      });
      expect(JSON.stringify(body)).not.toContain("secret note body");

      const note = await h.call("add_application_note", {
        requestId: crypto.randomUUID(),
        applicationId: body.applicationId,
        expectedVersion: 1,
        note: "another private note",
        noteDate: "2026-09-20",
      });
      expect(note.body).toMatchObject({ ok: true, version: 2, after: { noteDate: "2026-09-20" } });
      expect(typeof note.body.noteId).toBe("string");
      expect(JSON.stringify(note.body)).not.toContain("another private note");
    });
  });

  describe("reads", () => {
    it("search results omit descriptions and notes", async () => {
      await h.seed(OWNER_ID, {
        company: "Datadog",
        title: "Backend Engineer",
        description: "very long description",
        initialNote: "private note",
      });
      const { body } = await h.call("search_applications", { text: "datadog" });
      const items = body.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(1);
      expect(items[0]).not.toHaveProperty("description");
      expect(JSON.stringify(body)).not.toContain("private note");
      expect(JSON.stringify(body)).not.toContain("very long description");
      expect(items[0]).toMatchObject({ company: "Datadog", title: "Backend Engineer", version: 1 });
    });

    it("pipeline summary counts by status", async () => {
      await h.seed(OWNER_ID, { company: "A", title: "x", status: "APPLIED" });
      await h.seed(OWNER_ID, { company: "B", title: "y", status: "REJECTED" });
      const { body } = await h.call("get_pipeline_summary", {});
      expect(body.total).toBe(2);
      expect((body.byStatus as Record<string, number>).APPLIED).toBe(1);
      expect(body.active).toBe(1);
    });
  });
});
