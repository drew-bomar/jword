import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { JwordError } from "../src/domain/errors";
import { createTrackerServices, type TrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const OTHER: ActorContext = { userId: "22222222-2222-4222-8222-222222222222", actorType: "USER" };
const CODEX: ActorContext = { ...OWNER, actorType: "CODEX" };

let repo: FakeTrackerRepository;
let services: TrackerServices;

beforeEach(() => {
  repo = new FakeTrackerRepository();
  services = createTrackerServices({ repository: repo, clock: fixedClock("2026-09-21") });
});

async function expectError(
  promise: Promise<unknown>,
  code: string,
  reason?: string,
): Promise<JwordError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JwordError);
    const typed = error as JwordError;
    expect(typed.code).toBe(code);
    if (reason) expect(typed.reason).toBe(reason);
    return typed;
  }
  throw new Error(`expected ${code}`);
}

async function create(overrides: Record<string, unknown> = {}, actor = OWNER) {
  return services.createApplication(
    { requestId: randomUUID(), company: "IBM", title: "Software Engineer", ...overrides },
    actor,
  );
}

describe("createApplication", () => {
  it("defaults dateFound to today and leaves appliedAt blank for SAVED", async () => {
    const result = await create();
    expect(result.ok).toBe(true);
    expect(result.version).toBe(1);
    expect(result.after).toMatchObject({
      status: "SAVED",
      dateFound: "2026-09-21",
      appliedAt: null,
    });
    const view = await services.getApplication({ applicationId: result.applicationId }, OWNER);
    expect(view.application.dateFound).toBe("2026-09-21");
    expect(view.activity.items).toHaveLength(1);
    expect(view.activity.items[0]).toMatchObject({ type: "CREATED", actorType: "USER" });
  });

  it("defaults appliedAt to today when created as APPLIED, explicit null stays null", async () => {
    const applied = await create({ status: "APPLIED" });
    expect(applied.after.appliedAt).toBe("2026-09-21");
    const blank = await create({
      company: "Datadog",
      status: "APPLIED",
      appliedAt: null,
      dateFound: null,
    });
    expect(blank.after.appliedAt).toBeNull();
    expect(blank.after.dateFound).toBeNull();
    const explicit = await create({ company: "Ramp", status: "APPLIED", appliedAt: "2026-09-01" });
    expect(explicit.after.appliedAt).toBe("2026-09-01");
  });

  it("stores an initial note and references it from the CREATED activity", async () => {
    const result = await create({ initialNote: "First impression" });
    expect(result.noteId).toBeTruthy();
    const view = await services.getApplication({ applicationId: result.applicationId }, OWNER);
    expect(view.notes.items).toHaveLength(1);
    expect(view.notes.items[0]).toMatchObject({ body: "First impression" });
    expect(view.activity.items[0]!.metadata.noteId).toBe(result.noteId);
    expect(view.application.version).toBe(1);
  });

  it("returns duplicate candidates as CONFLICT and creates nothing", async () => {
    const first = await create();
    const error = await expectError(
      create({ company: "ibm ", title: "software  engineer" }),
      "CONFLICT",
      "DUPLICATE_CANDIDATES",
    );
    expect(error.details.candidates?.[0]).toMatchObject({
      applicationId: first.applicationId,
      matchedOn: ["company_title"],
    });
    expect(repo.applications).toHaveLength(1);
    expect(repo.activities).toHaveLength(1);
  });

  it("allowDuplicate creates a distinct application on the same company", async () => {
    const first = await create();
    const second = await create({ allowDuplicate: true });
    expect(second.applicationId).not.toBe(first.applicationId);
    expect(second.companyId).toBe(first.companyId);
    expect(repo.jobs).toHaveLength(2);
  });

  it("reuses a company by normalized name but keeps Acme and Acme Inc. separate", async () => {
    const a = await create({ company: "Acme", title: "A" });
    const b = await create({ company: "  ACME ", title: "B" });
    const c = await create({ company: "Acme Inc.", title: "C" });
    expect(b.companyId).toBe(a.companyId);
    expect(c.companyId).not.toBe(a.companyId);
    expect(repo.companies).toHaveLength(2);
  });

  it("rejects invalid input before touching the repository", async () => {
    await expectError(create({ status: "HIRED" }), "VALIDATION_ERROR");
    await expectError(create({ bogus: 1 }), "VALIDATION_ERROR");
    expect(repo.applications).toHaveLength(0);
  });
});

describe("updateApplicationStatus", () => {
  it("records STATUS_CHANGED with before/after and increments version once", async () => {
    const created = await create({ status: "APPLIED", appliedAt: "2026-09-10" });
    const result = await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "OA",
      },
      CODEX,
    );
    expect(result).toMatchObject({
      noop: false,
      version: 2,
      changedFields: ["status"],
      before: { status: "APPLIED" },
      after: { status: "OA" },
    });
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.application.version).toBe(2);
    expect(view.activity.items[0]).toMatchObject({
      type: "STATUS_CHANGED",
      actorType: "CODEX",
      activityId: result.activityId,
    });
  });

  it("defaults appliedAt to today when moving to APPLIED without a date", async () => {
    const created = await create();
    const result = await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "APPLIED",
      },
      OWNER,
    );
    expect(result.changedFields).toEqual(["status", "appliedAt"]);
    expect(result.after.appliedAt).toBe("2026-09-21");
  });

  it("explicit null keeps appliedAt blank when entering APPLIED", async () => {
    const created = await create();
    const result = await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "APPLIED",
        appliedAt: null,
      },
      OWNER,
    );
    expect(result.changedFields).toEqual(["status"]);
    expect(
      (await services.getApplication({ applicationId: created.applicationId }, OWNER)).application
        .appliedAt,
    ).toBeNull();
  });

  it("unchanged status is a no-op with no activity or version bump, but a receipt", async () => {
    const created = await create({ status: "APPLIED" });
    const requestId = randomUUID();
    const first = await services.updateApplicationStatus(
      { requestId, applicationId: created.applicationId, expectedVersion: 1, status: "APPLIED" },
      OWNER,
    );
    expect(first).toMatchObject({ noop: true, version: 1, replayed: false, changedFields: [] });
    expect(repo.activities).toHaveLength(1);
    const replay = await services.updateApplicationStatus(
      { requestId, applicationId: created.applicationId, expectedVersion: 1, status: "APPLIED" },
      OWNER,
    );
    expect(replay).toMatchObject({ noop: true, replayed: true });
  });

  it("does not fill a missing date when an already-APPLIED status is resubmitted", async () => {
    const created = await create({ status: "APPLIED", appliedAt: null });
    const result = await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "APPLIED",
      },
      OWNER,
    );
    expect(result.noop).toBe(true);
  });

  it("date-only change records DETAILS_UPDATED", async () => {
    const created = await create({ status: "APPLIED", appliedAt: "2026-09-10" });
    const result = await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "APPLIED",
        appliedAt: "2026-09-12",
      },
      OWNER,
    );
    expect(result.changedFields).toEqual(["appliedAt"]);
    expect(repo.activities.at(-1)).toMatchObject({ type: "DETAILS_UPDATED" });
  });

  it("returning to an earlier status preserves appliedAt", async () => {
    const created = await create({ status: "APPLIED", appliedAt: "2026-09-10" });
    await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "SAVED",
      },
      OWNER,
    );
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.application).toMatchObject({
      status: "SAVED",
      appliedAt: "2026-09-10",
      version: 2,
    });
  });

  it("stale version returns CONFLICT and changes nothing", async () => {
    const created = await create();
    await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "OA",
      },
      OWNER,
    );
    const error = await expectError(
      services.updateApplicationStatus(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          status: "INTERVIEW",
        },
        OWNER,
      ),
      "CONFLICT",
      "STALE_VERSION",
    );
    expect(error.details).toMatchObject({ currentVersion: 2, expectedVersion: 1 });
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.application).toMatchObject({ status: "OA", version: 2 });
    expect(repo.activities).toHaveLength(2);
  });

  it("accepts an explicit occurredAt for the activity", async () => {
    const created = await create();
    await services.updateApplicationStatus(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        status: "OA",
        occurredAt: "2026-09-15T10:00:00Z",
      },
      OWNER,
    );
    expect(repo.activities.at(-1)!.occurredAt).toBe("2026-09-15T10:00:00Z");
  });
});

describe("updateApplicationDetails", () => {
  it("updates allowed application and job fields and reports changed names", async () => {
    const created = await create();
    const result = await services.updateApplicationDetails(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        priority: "HIGH",
        location: "Austin, TX",
        jobUrl: "https://ibm.com/jobs/1",
        referral: "Jane",
      },
      OWNER,
    );
    expect(result.changedFields.sort()).toEqual(["jobUrl", "location", "priority", "referral"]);
    expect(result.version).toBe(2);
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.application).toMatchObject({
      priority: "HIGH",
      location: "Austin, TX",
      jobUrl: "https://ibm.com/jobs/1",
      referral: "Jane",
    });
    expect(view.activity.items[0]).toMatchObject({ type: "DETAILS_UPDATED" });
  });

  it("is a no-op when all values already match", async () => {
    const created = await create({ priority: "HIGH" });
    const result = await services.updateApplicationDetails(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        priority: "HIGH",
      },
      OWNER,
    );
    expect(result).toMatchObject({ noop: true, version: 1, changedFields: [] });
    expect(repo.activities).toHaveLength(1);
  });

  it("rejects empty and disallowed updates", async () => {
    const created = await create();
    await expectError(
      services.updateApplicationDetails(
        { requestId: randomUUID(), applicationId: created.applicationId, expectedVersion: 1 },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
    await expectError(
      services.updateApplicationDetails(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          status: "OA",
        },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
  });

  it("relinks the job to another company without renaming the shared company", async () => {
    const a = await create({ company: "IBM", title: "A" });
    const b = await create({ company: "IBM", title: "B" });
    const result = await services.updateApplicationDetails(
      {
        requestId: randomUUID(),
        applicationId: a.applicationId,
        expectedVersion: 1,
        company: "Acme",
      },
      OWNER,
    );
    expect(result.changedFields).toEqual(["company"]);
    expect(
      (await services.getApplication({ applicationId: a.applicationId }, OWNER)).application
        .company,
    ).toBe("Acme");
    expect(
      (await services.getApplication({ applicationId: b.applicationId }, OWNER)).application
        .company,
    ).toBe("IBM");
    expect(repo.companies.map((c) => c.name).sort()).toEqual(["Acme", "IBM"]);
  });

  it("clearing a value with null is a change", async () => {
    const created = await create({ location: "Austin" });
    const result = await services.updateApplicationDetails(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        location: null,
      },
      OWNER,
    );
    expect(result.changedFields).toEqual(["location"]);
    expect(result.before.location).toBe("Austin");
  });
});

describe("notes", () => {
  it("adds notes, incrementing the version each time", async () => {
    const created = await create();
    const first = await services.addApplicationNote(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        note: "Hello",
      },
      OWNER,
    );
    expect(first).toMatchObject({ version: 2, changedFields: ["note"], before: {}, after: {} });
    const second = await services.addApplicationNote(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 2,
        note: "Second",
      },
      OWNER,
    );
    expect(second).toMatchObject({ version: 3 });
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.notes.items).toHaveLength(2);
    expect(view.activity.items.filter((a) => a.type === "NOTE_ADDED")).toHaveLength(2);
  });

  it("rejects the removed noteDate field on add and update", async () => {
    const created = await create();
    await expectError(
      services.addApplicationNote(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          note: "Hello",
          noteDate: "2026-09-20",
        },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
    expect(repo.notes).toHaveLength(0);
  });

  it("edits note text and no-ops identical text", async () => {
    const created = await create();
    const added = await services.addApplicationNote(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        expectedVersion: 1,
        note: "Hello",
      },
      OWNER,
    );
    const noteId = added.noteId!;
    const text = await services.updateApplicationNote(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        noteId,
        expectedVersion: 2,
        note: "Hello again",
      },
      OWNER,
    );
    expect(text).toMatchObject({ changedFields: ["note"], version: 3 });
    expect(text.after).toEqual({});
    expect(text.before).toEqual({});
    const noop = await services.updateApplicationNote(
      {
        requestId: randomUUID(),
        applicationId: created.applicationId,
        noteId,
        expectedVersion: 3,
        note: "Hello again",
      },
      OWNER,
    );
    expect(noop).toMatchObject({ noop: true, version: 3 });
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    expect(view.notes.items[0]).toMatchObject({ body: "Hello again" });
    expect(view.notes.items[0]!.createdAt).toBe(repo.notes[0]!.createdAt);
    const updates = view.activity.items.filter((a) => a.type === "NOTE_UPDATED");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata).toMatchObject({
      noteId,
      fields: ["note"],
      before: { note: "Hello" },
      after: { note: "Hello again" },
    });
  });

  it("rejects unknown note ids and notes on another user's application", async () => {
    const created = await create();
    await expectError(
      services.updateApplicationNote(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          noteId: randomUUID(),
          expectedVersion: 1,
          note: "x",
        },
        OWNER,
      ),
      "NOT_FOUND",
    );
    await expectError(
      services.addApplicationNote(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          note: "x",
        },
        OTHER,
      ),
      "NOT_FOUND",
    );
  });
});

describe("retry protection", () => {
  it("replays an identical request without repeating effects", async () => {
    const requestId = randomUUID();
    const command = { requestId, company: "IBM", title: "SWE", initialNote: "n" };
    const first = await services.createApplication(command, OWNER);
    const second = await services.createApplication(command, OWNER);
    expect(second.replayed).toBe(true);
    expect(second.applicationId).toBe(first.applicationId);
    expect(repo.applications).toHaveLength(1);
    expect(repo.notes).toHaveLength(1);
    expect(repo.activities).toHaveLength(1);
  });

  it("replays a status update even though its own commit bumped the version", async () => {
    const created = await create();
    const requestId = randomUUID();
    const command = {
      requestId,
      applicationId: created.applicationId,
      expectedVersion: 1,
      status: "OA" as const,
    };
    const first = await services.updateApplicationStatus(command, OWNER);
    const second = await services.updateApplicationStatus(command, OWNER);
    expect(second).toMatchObject({ replayed: true, version: 2, activityId: first.activityId });
    expect(repo.applications[0]!.version).toBe(2);
    expect(repo.activities).toHaveLength(2);
  });

  it("rejects a reused request id with a different command", async () => {
    const created = await create();
    const requestId = randomUUID();
    await services.updateApplicationStatus(
      { requestId, applicationId: created.applicationId, expectedVersion: 1, status: "OA" },
      OWNER,
    );
    await expectError(
      services.updateApplicationStatus(
        {
          requestId,
          applicationId: created.applicationId,
          expectedVersion: 2,
          status: "INTERVIEW",
        },
        OWNER,
      ),
      "CONFLICT",
      "REQUEST_ID_REUSED",
    );
    expect(repo.applications[0]!.status).toBe("OA");
  });

  it("keeps receipts owner-scoped", async () => {
    const requestId = randomUUID();
    await services.createApplication({ requestId, company: "IBM", title: "SWE" }, OWNER);
    const other = await services.createApplication(
      { requestId, company: "IBM", title: "SWE" },
      OTHER,
    );
    expect(other.replayed).toBe(false);
    expect(repo.applications).toHaveLength(2);
  });
});

describe("ownership", () => {
  it("another user cannot read or mutate the owner's application", async () => {
    const created = await create();
    await expectError(
      services.getApplication({ applicationId: created.applicationId }, OTHER),
      "NOT_FOUND",
    );
    await expectError(
      services.listApplicationActivity({ applicationId: created.applicationId }, OTHER),
      "NOT_FOUND",
    );
    await expectError(
      services.updateApplicationStatus(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          status: "OA",
        },
        OTHER,
      ),
      "NOT_FOUND",
    );
    await expectError(
      services.updateApplicationDetails(
        {
          requestId: randomUUID(),
          applicationId: created.applicationId,
          expectedVersion: 1,
          priority: "HIGH",
        },
        OTHER,
      ),
      "NOT_FOUND",
    );
    expect((await services.searchApplications({}, OTHER)).items).toHaveLength(0);
    expect(repo.applications[0]).toMatchObject({ status: "SAVED", version: 1 });
  });
});

describe("atomicity", () => {
  it("rolls back the primary change when the activity write fails", async () => {
    const created = await create();
    repo.failBeforeActivity = true;
    const requestId = randomUUID();
    await expectError(
      services.updateApplicationStatus(
        { requestId, applicationId: created.applicationId, expectedVersion: 1, status: "OA" },
        OWNER,
      ),
      "INTERNAL_ERROR",
    );
    expect(repo.applications[0]).toMatchObject({ status: "SAVED", version: 1 });
    expect(repo.activities).toHaveLength(1);
    expect(repo.receipts.has(`${OWNER.userId}:${requestId}`)).toBe(false);
  });

  it("rolls back a whole import batch when a later row fails", async () => {
    await create({ company: "Acme", title: "Existing" });
    repo.failBeforeActivity = false;
    const before = { apps: repo.applications.length, companies: repo.companies.length };
    await expectError(
      services.commitImport(
        {
          requestId: randomUUID(),
          rows: [
            { rowIndex: 1, company: "Datadog", title: "Backend" },
            { rowIndex: 2, company: "acme", title: "existing" },
          ],
        },
        OWNER,
      ),
      "IMPORT_ROW_ERROR",
      "DUPLICATE_UNRESOLVED",
    );
    expect(repo.applications).toHaveLength(before.apps);
    expect(repo.companies).toHaveLength(before.companies);
    expect(repo.activities).toHaveLength(1);
  });
});

describe("import", () => {
  it("commits rows with IMPORT actor, null dates, and undated notes", async () => {
    const result = await services.commitImport(
      {
        requestId: randomUUID(),
        rows: [
          {
            rowIndex: 1,
            company: "Datadog",
            title: "Backend",
            status: "APPLIED",
            note: "line1\nline2",
          },
          { rowIndex: 2, company: "Ramp", title: "Platform", appliedAt: "2026-09-01" },
        ],
      },
      OWNER,
    );
    expect(result).toMatchObject({ imported: 2 });
    expect(result.applicationIds).toHaveLength(2);
    const first = await services.getApplication(
      { applicationId: result.applicationIds![0]! },
      OWNER,
    );
    expect(first.application).toMatchObject({
      status: "APPLIED",
      appliedAt: null,
      dateFound: null,
    });
    expect(first.notes.items[0]).toMatchObject({ body: "line1\nline2" });
    expect(first.activity.items[0]).toMatchObject({ type: "IMPORTED", actorType: "IMPORT" });
    expect(first.activity.items[0]!.metadata.noteId).toBe(first.notes.items[0]!.noteId);
    const second = await services.getApplication(
      { applicationId: result.applicationIds![1]! },
      OWNER,
    );
    expect(second.application.appliedAt).toBe("2026-09-01");
  });

  it("import_separate creates distinct records and a replay does not duplicate", async () => {
    const existing = await create({ company: "Acme", title: "SWE" });
    const requestId = randomUUID();
    const command = {
      requestId,
      rows: [
        { rowIndex: 1, company: "Acme", title: "SWE", duplicateChoice: "import_separate" as const },
      ],
    };
    const result = await services.commitImport(command, OWNER);
    expect(result.applicationIds![0]).not.toBe(existing.applicationId);
    expect(repo.jobs).toHaveLength(2);
    const replay = await services.commitImport(command, OWNER);
    expect(replay.replayed).toBe(true);
    expect(repo.applications).toHaveLength(2);
  });

  it("previewImport validates and flags duplicates without writing", async () => {
    await create({ company: "IBM", title: "Software Engineer" });
    const preview = await services.previewImport(
      {
        csvText:
          "Company,Role,Status,Date Applied\nibm,Software Engineer,applied,9/1/2026\nDatadog,Backend,ghosted,\n,Missing,,\nDatadog,backend,,\nDatadog,Backend,saved,\n",
        mapping: {
          company: 0,
          title: 1,
          status: 2,
          priority: null,
          jobUrl: null,
          externalJobId: null,
          location: null,
          workArrangement: null,
          datePosted: null,
          dateFound: null,
          appliedAt: 3,
          source: null,
          resumeVersion: null,
          referral: null,
          note: null,
        },
      },
      OWNER,
    );
    expect(preview.totalRows).toBe(5);
    expect(preview.validCount).toBe(3);
    expect(preview.errorCount).toBe(2);
    expect(preview.flaggedCount).toBe(2);
    expect(preview.rows[0]!.duplicates).toHaveLength(1);
    expect(preview.rows[1]!.errors[0]!.field).toBe("status");
    // Row 2 errored, so it is not a duplicate source; row 5 duplicates row 4.
    expect(preview.rows[3]!.duplicateOfRows).toEqual([]);
    expect(preview.rows[4]!.duplicateOfRows).toEqual([4]);
    expect(repo.applications).toHaveLength(1);
  });

  it("previewImport requires the required mappings", async () => {
    await expectError(
      services.previewImport(
        {
          csvText: "A\n1",
          mapping: {
            company: null,
            title: 0,
            status: null,
            priority: null,
            jobUrl: null,
            externalJobId: null,
            location: null,
            workArrangement: null,
            datePosted: null,
            dateFound: null,
            appliedAt: null,
            source: null,
            resumeVersion: null,
            referral: null,
            note: null,
          },
        },
        OWNER,
      ),
      "VALIDATION_ERROR",
    );
  });
});

describe("search and summaries", () => {
  async function seed() {
    const a = await create({
      company: "IBM",
      title: "Backend Engineer",
      status: "APPLIED",
      appliedAt: "2026-09-01",
      priority: "HIGH",
    });
    const b = await create({
      company: "Datadog",
      title: "Backend Engineer",
      status: "SAVED",
      priority: "LOW",
    });
    const c = await create({
      company: "Acme",
      title: "Frontend",
      status: "REJECTED",
      appliedAt: "2026-08-15",
      priority: "MEDIUM",
    });
    return { a, b, c };
  }

  it("filters by text, status, and priority", async () => {
    await seed();
    expect((await services.searchApplications({ text: "backend" }, OWNER)).items).toHaveLength(2);
    expect((await services.searchApplications({ text: "acme" }, OWNER)).items).toHaveLength(1);
    expect(
      (await services.searchApplications({ statuses: ["APPLIED", "SAVED"] }, OWNER)).items,
    ).toHaveLength(2);
    expect(
      (await services.searchApplications({ priorities: ["HIGH"] }, OWNER)).items[0]!.company,
    ).toBe("IBM");
    expect(
      (await services.searchApplications({ appliedFrom: "2026-08-20" }, OWNER)).items,
    ).toHaveLength(1);
  });

  it("sorts by updated, applied (nulls last), company, and priority", async () => {
    await seed();
    const updated = await services.searchApplications({ sort: "updated" }, OWNER);
    expect(updated.items.map((i) => i.company)).toEqual(["Acme", "Datadog", "IBM"]);
    const applied = await services.searchApplications(
      { sort: "applied", direction: "desc" },
      OWNER,
    );
    expect(applied.items.map((i) => i.company)).toEqual(["IBM", "Acme", "Datadog"]);
    const company = await services.searchApplications({ sort: "company" }, OWNER);
    expect(company.items.map((i) => i.company)).toEqual(["Acme", "Datadog", "IBM"]);
    const priority = await services.searchApplications(
      { sort: "priority", direction: "desc" },
      OWNER,
    );
    expect(priority.items.map((i) => i.priority)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });

  it("pages with cursors bound to the filter set", async () => {
    await seed();
    const page1 = await services.searchApplications({ limit: 2, sort: "company" }, OWNER);
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await services.searchApplications(
      { limit: 2, sort: "company", cursor: page1.nextCursor! },
      OWNER,
    );
    expect(page2.items.map((i) => i.company)).toEqual(["IBM"]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    await expectError(
      services.searchApplications({ limit: 2, sort: "updated", cursor: page1.nextCursor! }, OWNER),
      "VALIDATION_ERROR",
    );
    await expectError(
      services.searchApplications({ limit: 2, sort: "company", cursor: "garbage" }, OWNER),
      "VALIDATION_ERROR",
    );
  });

  it("omits notes and descriptions from search items", async () => {
    await create({ initialNote: "secret", description: "long text" });
    const item = (await services.searchApplications({}, OWNER)).items[0]!;
    expect(item).not.toHaveProperty("description");
    expect(JSON.stringify(item)).not.toContain("secret");
  });

  it("counts statuses and lists stale active applications", async () => {
    const { a } = await seed();
    const counts = await services.getStatusCounts(OWNER);
    expect(counts).toMatchObject({
      total: 3,
      active: 2,
      byStatus: { APPLIED: 1, SAVED: 1, REJECTED: 1, OA: 0 },
    });
    // Fake repo timestamps are near 2026-09-21T15:00Z; the fixed clock's now() is 2026-09-21T12:00Z,
    // so treat everything as stale by looking far ahead.
    const summary = await services.getPipelineSummary({ staleAfterDays: 1 }, { ...OWNER });
    expect(summary.staleAfterDays).toBe(1);
    expect(summary.stale.every((s) => s.status !== "REJECTED")).toBe(true);
    // Move one application recently: a stale threshold in the past excludes it once we bump time.
    await services.updateApplicationStatus(
      { requestId: randomUUID(), applicationId: a.applicationId, expectedVersion: 1, status: "OA" },
      OWNER,
    );
    const fresh = createTrackerServices({
      repository: repo,
      clock: { today: () => "2026-10-21", now: () => new Date("2026-10-21T12:00:00Z") },
    });
    const later = await fresh.getPipelineSummary({ staleAfterDays: 14, staleLimit: 5 }, OWNER);
    expect(later.stale.map((s) => s.company).sort()).toEqual(["Datadog", "IBM"]);
    expect(later.stale[0]!.company).toBe("Datadog");
    await expectError(
      services.getPipelineSummary({ staleAfterDays: 0 }, OWNER),
      "VALIDATION_ERROR",
    );
  });

  it("candidate profile round-trips", async () => {
    expect(await services.getCandidateProfile(OWNER)).toBeNull();
    const saved = await services.saveCandidateProfile(
      { fullName: "Drew", email: "", requiresSponsorship: false },
      OWNER,
    );
    expect(saved).toMatchObject({ fullName: "Drew", email: null, requiresSponsorship: false });
    expect(await services.getCandidateProfile(OTHER)).toBeNull();
    await expectError(services.saveCandidateProfile({ email: "bad" }, OWNER), "VALIDATION_ERROR");
  });
});
