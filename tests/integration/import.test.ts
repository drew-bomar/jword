import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { suggestMapping } from "@jword/core";
import {
  cleanupUsers,
  closePg,
  createTestUser,
  db,
  expectJwordError,
  rid,
  type TestUser,
} from "./helpers";

const CSV = [
  "Company,Role,Status,Date applied,Job URL,Notes",
  'Datadog,Backend Engineer,APPLIED,,https://jobs.example.com/dd/1,"line one\nline two"',
  "Datadog,Backend Engineer,SAVED,,https://jobs.example.com/dd/1,",
  "Garmin,Firmware Engineer,Applied,9/1/2026,,",
  "Ramp,Backend Engineer,not-a-status,,,",
].join("\n");

describe("CSV import: preview then all-or-nothing commit", () => {
  let u: TestUser;
  let existingId: string;

  beforeAll(async () => {
    u = await createTestUser("import");
    const existing = await u.services.createApplication(
      { requestId: rid(), company: "Garmin", title: "Firmware Engineer" },
      u.actor,
    );
    existingId = existing.applicationId!;
  });

  afterAll(async () => {
    await cleanupUsers();
    await closePg();
  });

  it("preview validates and flags duplicates without writing", async () => {
    const before = (await db.apps(u.id)).length;
    const mapping = suggestMapping([
      "Company",
      "Role",
      "Status",
      "Date applied",
      "Job URL",
      "Notes",
    ]);
    const preview = await u.services.previewImport({ csvText: CSV, mapping }, u.actor);
    expect((await db.apps(u.id)).length).toBe(before);
    expect(preview.totalRows).toBe(4);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[3]!.errors[0]!.message).toMatch(/Unknown status/);
    // row 2 duplicates row 1 within the upload (company/title and URL)
    expect(preview.rows[1]!.duplicateOfRows).toEqual([1]);
    // row 3 duplicates the existing Garmin application
    expect(preview.rows[2]!.duplicates[0]).toMatchObject({
      applicationId: existingId,
      matchedOn: ["company_title"],
    });
    expect(preview.rows[2]!.values?.appliedAt).toBe("2026-09-01");
    expect(preview.rows[0]!.warnings[0]!.message).toMatch(/APPLIED/);
    expect(preview.flaggedCount).toBe(2);
  });

  it("commit rejects an unresolved duplicate and writes nothing", async () => {
    const before = (await db.apps(u.id)).length;
    const error = await expectJwordError(
      u.services.commitImport(
        {
          requestId: rid(),
          rows: [
            { rowIndex: 1, company: "Brand New Co", title: "SWE" },
            { rowIndex: 3, company: "Garmin", title: "Firmware Engineer", appliedAt: "2026-09-01" },
          ],
        },
        u.actor,
      ),
      "IMPORT_ROW_ERROR",
      "DUPLICATE_UNRESOLVED",
    );
    expect(error.details.rowIndex).toBe(3);
    expect((await db.apps(u.id)).length).toBe(before);
    expect((await db.companies(u.id)).some((c) => c.name === "Brand New Co")).toBe(false);
  });

  it("commit honors import_separate, keeps missing dates null, creates notes, and replays safely", async () => {
    const before = (await db.apps(u.id)).length;
    const requestId = rid();
    const command = {
      requestId,
      rows: [
        {
          rowIndex: 1,
          company: "Datadog",
          title: "Backend Engineer",
          status: "APPLIED" as const,
          jobUrl: "https://jobs.example.com/dd/1",
          note: "line one\nline two",
        },
        {
          rowIndex: 2,
          company: "Datadog",
          title: "Backend Engineer",
          jobUrl: "https://jobs.example.com/dd/1",
          duplicateChoice: "import_separate" as const,
        },
        {
          rowIndex: 3,
          company: "Garmin",
          title: "Firmware Engineer",
          status: "APPLIED" as const,
          appliedAt: "2026-09-01",
          duplicateChoice: "import_separate" as const,
        },
      ],
    };
    const result = await u.services.commitImport(command, u.actor);
    expect(result).toMatchObject({ ok: true, replayed: false, imported: 3 });
    expect((await db.apps(u.id)).length).toBe(before + 3);

    const [first, second, third] = result.applicationIds!;
    const firstApp = (await db.app(first!))!;
    expect(firstApp).toMatchObject({ status: "APPLIED", applied_at: null, date_found: null });
    const notes = await db.notes(first!);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "line one\nline two" });
    const activity = (await db.activities(first!))[0]!;
    expect(activity).toMatchObject({ type: "IMPORTED", actor_type: "IMPORT" });
    expect((activity.metadata as Record<string, unknown>).noteId).toBe(notes[0]!.id);

    // distinct job/application pair, same URL, same company row
    const secondApp = (await db.app(second!))!;
    expect(secondApp.job_id).not.toBe(firstApp.job_id);
    const jobs = await db.jobs(u.id);
    expect(jobs.find((j) => j.id === firstApp.job_id)!.company_id).toBe(
      jobs.find((j) => j.id === secondApp.job_id)!.company_id,
    );
    expect(jobs.find((j) => j.id === secondApp.job_id)!.job_url).toBe(
      "https://jobs.example.com/dd/1",
    );
    expect((await db.app(third!))!.applied_at).toBe("2026-09-01");
    expect((await db.app(existingId))!.version).toBe(1);

    const replay = await u.services.commitImport(command, u.actor);
    expect(replay).toMatchObject({ replayed: true, imported: 3 });
    expect((await db.apps(u.id)).length).toBe(before + 3);
  });

  it("rejects batches over the row limit before touching the database", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      rowIndex: i + 1,
      company: `Big ${i}`,
      title: "SWE",
    }));
    await expectJwordError(
      u.services.commitImport({ requestId: rid(), rows }, u.actor),
      "VALIDATION_ERROR",
    );
  });
});
