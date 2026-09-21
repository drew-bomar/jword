import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  closePg,
  createTestUser,
  db,
  expectJwordError,
  rid,
  TODAY,
  type TestUser,
} from "./helpers";

describe("Web-path mutations through the shared services", () => {
  let u: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    u = await createTestUser("mut");
    other = await createTestUser("mut-other");
  });

  afterAll(async () => {
    await cleanupUsers();
    await closePg();
  });

  it("creates company, job, application, initial note, and CREATED activity atomically with date defaults", async () => {
    const result = await u.services.createApplication(
      {
        requestId: rid(),
        company: "  Datadog ",
        title: "Backend Engineer",
        status: "APPLIED",
        initialNote: "first",
      },
      u.actor,
    );
    expect(result).toMatchObject({ ok: true, replayed: false, noop: false, version: 1 });
    expect(result.after).toMatchObject({ status: "APPLIED", dateFound: TODAY, appliedAt: TODAY });
    const app = await db.app(result.applicationId!);
    expect(app).toMatchObject({
      status: "APPLIED",
      date_found: TODAY,
      applied_at: TODAY,
      version: 1,
    });
    const notes = await db.notes(result.applicationId!);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "first", note_date: null, id: result.noteId });
    const activities = await db.activities(result.applicationId!);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: "CREATED", actor_type: "USER" });
    expect((activities[0]!.metadata as Record<string, unknown>).noteId).toBe(result.noteId);
    const companies = await db.companies(u.id);
    expect(companies.find((c) => c.name === "Datadog")?.normalized_name).toBe("datadog");
  });

  it("explicit null dates stay blank; omitted appliedAt for non-APPLIED stays null", async () => {
    const r1 = await u.services.createApplication(
      {
        requestId: rid(),
        company: "NullCo",
        title: "A",
        status: "APPLIED",
        dateFound: null,
        appliedAt: null,
      },
      u.actor,
    );
    expect(await db.app(r1.applicationId!)).toMatchObject({ date_found: null, applied_at: null });
    const r2 = await u.services.createApplication(
      { requestId: rid(), company: "NullCo", title: "B" },
      u.actor,
    );
    expect(await db.app(r2.applicationId!)).toMatchObject({ date_found: TODAY, applied_at: null });
  });

  it("duplicate candidates block creation unless allowDuplicate is set", async () => {
    const before = (await db.apps(u.id)).length;
    const error = await expectJwordError(
      u.services.createApplication(
        { requestId: rid(), company: "datadog", title: "backend  engineer" },
        u.actor,
      ),
      "CONFLICT",
      "DUPLICATE_CANDIDATES",
    );
    expect(error.details.candidates?.[0]).toMatchObject({
      company: "Datadog",
      title: "Backend Engineer",
      status: "APPLIED",
    });
    expect(error.details.candidates?.[0]?.matchedOn).toContain("company_title");
    expect((await db.apps(u.id)).length).toBe(before);

    const second = await u.services.createApplication(
      { requestId: rid(), company: "datadog", title: "backend  engineer", allowDuplicate: true },
      u.actor,
    );
    expect(second.ok).toBe(true);
    expect((await db.apps(u.id)).length).toBe(before + 1);
    // company reused: still exactly one Datadog company row
    expect((await db.companies(u.id)).filter((c) => c.normalized_name === "datadog")).toHaveLength(
      1,
    );
  });

  it("company matching is conservative: IBM/ibm reuse, Acme vs Acme Inc. separate", async () => {
    await u.services.createApplication({ requestId: rid(), company: "IBM", title: "SWE" }, u.actor);
    await u.services.createApplication(
      { requestId: rid(), company: " ibm  ", title: "SRE" },
      u.actor,
    );
    await u.services.createApplication(
      { requestId: rid(), company: "Acme", title: "SWE" },
      u.actor,
    );
    await u.services.createApplication(
      { requestId: rid(), company: "Acme Inc.", title: "SWE" },
      u.actor,
    );
    const companies = await db.companies(u.id);
    expect(companies.filter((c) => c.normalized_name === "ibm")).toHaveLength(1);
    expect(companies.filter((c) => c.normalized_name.startsWith("acme"))).toHaveLength(2);
  });

  it("status change records STATUS_CHANGED, bumps version once; resubmitting is a no-op", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "StatusCo", title: "SWE" },
      u.actor,
    );
    const id = created.applicationId!;
    const before = (await db.app(id))!;

    const change = await u.services.updateApplicationStatus(
      { requestId: rid(), applicationId: id, expectedVersion: 1, status: "APPLIED" },
      u.actor,
    );
    expect(change).toMatchObject({
      noop: false,
      version: 2,
      changedFields: ["status", "appliedAt"],
    });
    expect(change.before).toEqual({ status: "SAVED", appliedAt: null });
    expect(change.after).toEqual({ status: "APPLIED", appliedAt: TODAY });
    const after = (await db.app(id))!;
    expect(after).toMatchObject({ status: "APPLIED", applied_at: TODAY, version: 2 });
    expect(new Date(after.last_activity_at).getTime()).toBeGreaterThan(
      new Date(before.last_activity_at).getTime(),
    );
    const activities = await db.activities(id);
    expect(activities).toHaveLength(2);
    expect(activities[1]).toMatchObject({ type: "STATUS_CHANGED" });
    expect(activities[1]!.metadata).toMatchObject({
      before: { status: "SAVED" },
      after: { status: "APPLIED" },
    });

    const noop = await u.services.updateApplicationStatus(
      { requestId: rid(), applicationId: id, expectedVersion: 2, status: "APPLIED" },
      u.actor,
    );
    expect(noop).toMatchObject({ noop: true, version: 2 });
    expect((await db.activities(id)).length).toBe(2);
    expect((await db.app(id))!.version).toBe(2);

    // date-only change → DETAILS_UPDATED
    const dateOnly = await u.services.updateApplicationStatus(
      {
        requestId: rid(),
        applicationId: id,
        expectedVersion: 2,
        status: "APPLIED",
        appliedAt: "2026-09-10",
      },
      u.actor,
    );
    expect(dateOnly).toMatchObject({ noop: false, version: 3, changedFields: ["appliedAt"] });
    expect((await db.activities(id)).at(-1)).toMatchObject({ type: "DETAILS_UPDATED" });

    // returning to an earlier status keeps the recorded date
    await u.services.updateApplicationStatus(
      { requestId: rid(), applicationId: id, expectedVersion: 3, status: "SAVED" },
      u.actor,
    );
    expect((await db.app(id))!).toMatchObject({
      status: "SAVED",
      applied_at: "2026-09-10",
      version: 4,
    });
  });

  it("details update: allowlist, no-op, and company relink without renaming", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "RelinkCo", title: "SWE", location: "Austin" },
      u.actor,
    );
    const id = created.applicationId!;

    await expectJwordError(
      u.services.updateApplicationDetails(
        { requestId: rid(), applicationId: id, expectedVersion: 1, version: 9 },
        u.actor,
      ),
      "VALIDATION_ERROR",
    );
    await expectJwordError(
      u.services.updateApplicationDetails(
        { requestId: rid(), applicationId: id, expectedVersion: 1 },
        u.actor,
      ),
      "VALIDATION_ERROR",
    );

    const noop = await u.services.updateApplicationDetails(
      {
        requestId: rid(),
        applicationId: id,
        expectedVersion: 1,
        location: "Austin",
        priority: "MEDIUM",
      },
      u.actor,
    );
    expect(noop).toMatchObject({ noop: true, version: 1 });
    expect((await db.activities(id)).length).toBe(1);

    const relink = await u.services.updateApplicationDetails(
      {
        requestId: rid(),
        applicationId: id,
        expectedVersion: 1,
        company: "RelinkCo Two",
        priority: "HIGH",
      },
      u.actor,
    );
    expect(relink).toMatchObject({ noop: false, version: 2 });
    expect(relink.changedFields).toEqual(expect.arrayContaining(["priority", "company"]));
    const companies = await db.companies(u.id);
    expect(companies.some((c) => c.name === "RelinkCo")).toBe(true);
    expect(companies.some((c) => c.name === "RelinkCo Two")).toBe(true);
    const jobs = await db.jobs(u.id);
    const jobId = (await db.app(id))!.job_id;
    const job = jobs.find((j) => j.id === jobId)!;
    expect(job.company_id).toBe(companies.find((c) => c.name === "RelinkCo Two")!.id);
    const last = (await db.activities(id)).at(-1)!;
    expect(last).toMatchObject({ type: "DETAILS_UPDATED" });
    expect(last.metadata).toMatchObject({
      before: { company: "RelinkCo", priority: "MEDIUM" },
      after: { company: "RelinkCo Two", priority: "HIGH" },
    });
  });

  it("notes: add, edit text, remove date; NOTE_UPDATED history keeps before/after", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "NoteCo", title: "SWE" },
      u.actor,
    );
    const id = created.applicationId!;
    const added = await u.services.addApplicationNote(
      {
        requestId: rid(),
        applicationId: id,
        expectedVersion: 1,
        note: "Finished OA",
        noteDate: "2026-09-20",
      },
      u.actor,
    );
    expect(added).toMatchObject({ version: 2, changedFields: ["note"] });
    expect(added.after).toEqual({ noteDate: "2026-09-20" });
    const noteId = added.noteId!;
    expect((await db.notes(id))[0]).toMatchObject({
      id: noteId,
      body: "Finished OA",
      note_date: "2026-09-20",
    });

    const edited = await u.services.updateApplicationNote(
      {
        requestId: rid(),
        applicationId: id,
        noteId,
        expectedVersion: 2,
        note: "Finished OA, felt good",
        noteDate: null,
      },
      u.actor,
    );
    expect(edited).toMatchObject({ version: 3, changedFields: ["note", "noteDate"], noteId });
    expect(edited.before).toEqual({});
    expect((await db.notes(id))[0]).toMatchObject({
      body: "Finished OA, felt good",
      note_date: null,
    });
    const last = (await db.activities(id)).at(-1)!;
    expect(last.type).toBe("NOTE_UPDATED");
    expect(last.metadata).toMatchObject({
      noteId,
      before: { note: "Finished OA", noteDate: "2026-09-20" },
      after: { note: "Finished OA, felt good", noteDate: null },
    });

    const noop = await u.services.updateApplicationNote(
      {
        requestId: rid(),
        applicationId: id,
        noteId,
        expectedVersion: 3,
        note: "Finished OA, felt good",
      },
      u.actor,
    );
    expect(noop).toMatchObject({ noop: true, version: 3 });

    await expectJwordError(
      u.services.updateApplicationNote(
        { requestId: rid(), applicationId: id, noteId: rid(), expectedVersion: 3, note: "x" },
        u.actor,
      ),
      "NOT_FOUND",
    );
  });

  it("stale version is rejected without changes; competing updates: only one wins", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "StaleCo", title: "SWE" },
      u.actor,
    );
    const id = created.applicationId!;
    const results = await Promise.allSettled([
      u.services.updateApplicationStatus(
        { requestId: rid(), applicationId: id, expectedVersion: 1, status: "OA" },
        u.actor,
      ),
      u.services.updateApplicationStatus(
        { requestId: rid(), applicationId: id, expectedVersion: 1, status: "INTERVIEW" },
        u.actor,
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const app = (await db.app(id))!;
    expect(app.version).toBe(2);
    expect((await db.activities(id)).length).toBe(2);

    const error = await expectJwordError(
      u.services.updateApplicationStatus(
        { requestId: rid(), applicationId: id, expectedVersion: 1, status: "FINAL" },
        u.actor,
      ),
      "CONFLICT",
      "STALE_VERSION",
    );
    expect(error.details).toMatchObject({ currentVersion: 2, expectedVersion: 1 });
    expect((await db.app(id))!.status).toBe(app.status);
    expect((await db.activities(id)).length).toBe(2);
  });

  it("retries: identical replay, changed command conflict, cross-owner isolation", async () => {
    const created = await u.services.createApplication(
      { requestId: rid(), company: "RetryCo", title: "SWE" },
      u.actor,
    );
    const id = created.applicationId!;
    const requestId = rid();
    const command = {
      requestId,
      applicationId: id,
      expectedVersion: 1,
      status: "APPLIED" as const,
    };

    const first = await u.services.updateApplicationStatus(command, u.actor);
    expect(first).toMatchObject({ replayed: false, version: 2 });
    const replay = await u.services.updateApplicationStatus(command, u.actor);
    expect(replay).toMatchObject({ replayed: true, version: 2, activityId: first.activityId });
    expect((await db.activities(id)).length).toBe(2);
    expect((await db.app(id))!.version).toBe(2);

    await expectJwordError(
      u.services.updateApplicationStatus({ ...command, status: "OA" }, u.actor),
      "CONFLICT",
      "REQUEST_ID_REUSED",
    );
    expect((await db.app(id))!.version).toBe(2);

    // The same request id under a different owner is an independent receipt.
    const otherCreated = await other.services.createApplication(
      { requestId: rid(), company: "RetryCo", title: "SWE" },
      other.actor,
    );
    const otherResult = await other.services.updateApplicationStatus(
      { requestId, applicationId: otherCreated.applicationId!, expectedVersion: 1, status: "OA" },
      other.actor,
    );
    expect(otherResult).toMatchObject({ replayed: false, noop: false, version: 2 });

    // Concurrent identical retries: exactly one write.
    const created2 = await u.services.createApplication(
      { requestId: rid(), company: "RetryCo", title: "SRE" },
      u.actor,
    );
    const id2 = created2.applicationId!;
    const cmd2 = {
      requestId: rid(),
      applicationId: id2,
      expectedVersion: 1,
      status: "OA" as const,
    };
    const both = await Promise.all([
      u.services.updateApplicationStatus(cmd2, u.actor),
      u.services.updateApplicationStatus(cmd2, u.actor),
    ]);
    expect(both.filter((r) => r.replayed)).toHaveLength(1);
    expect((await db.activities(id2)).length).toBe(2);
    expect((await db.app(id2))!.version).toBe(2);
  });
});
