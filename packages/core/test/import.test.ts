import { describe, expect, it } from "vitest";
import { applyMapping, missingRequiredMappings, suggestMapping } from "../src/import/mapping";
import {
  annotateDuplicates,
  isFlagged,
  parseDateCell,
  parsePriorityCell,
  parseStatusCell,
  validateImportRow,
  type DuplicateIndexEntry,
} from "../src/import/validate";

describe("suggestMapping", () => {
  it("maps realistic sheet headers", () => {
    const headers = ["Company", "Role", "Status", "Priority", "Link", "Location", "Date Applied", "Date Added", "Notes", "Referred By"];
    const mapping = suggestMapping(headers);
    expect(mapping.company).toBe(0);
    expect(mapping.title).toBe(1);
    expect(mapping.status).toBe(2);
    expect(mapping.priority).toBe(3);
    expect(mapping.jobUrl).toBe(4);
    expect(mapping.location).toBe(5);
    expect(mapping.appliedAt).toBe(6);
    expect(mapping.dateFound).toBe(7);
    expect(mapping.note).toBe(8);
    expect(mapping.referral).toBe(9);
    expect(mapping.externalJobId).toBeNull();
    expect(missingRequiredMappings(mapping)).toEqual([]);
  });

  it("does not map the same column twice and reports missing required fields", () => {
    const mapping = suggestMapping(["Job", "Something"]);
    expect(mapping.title).toBe(0);
    expect(mapping.company).toBeNull();
    expect(missingRequiredMappings(mapping)).toEqual(["company"]);
  });

  it("applyMapping only includes mapped fields", () => {
    const mapping = suggestMapping(["Company", "Role"]);
    expect(applyMapping(["IBM", "SWE"], mapping)).toEqual({ company: "IBM", title: "SWE" });
  });
});

describe("cell parsers", () => {
  it("status aliases and unknown values", () => {
    expect(parseStatusCell("applied").value).toBe("APPLIED");
    expect(parseStatusCell("Ready to apply").value).toBe("READY_TO_APPLY");
    expect(parseStatusCell("Online Assessment").value).toBe("OA");
    expect(parseStatusCell("")).toEqual({});
    expect(parseStatusCell("Ghosted").error).toMatch(/Unknown status/);
  });

  it("priority unknown is an error", () => {
    expect(parsePriorityCell("high").value).toBe("HIGH");
    expect(parsePriorityCell("urgent").error).toMatch(/Unknown priority/);
  });

  it("dates: accepted forms and rejections", () => {
    expect(parseDateCell("2026-09-21").value).toBe("2026-09-21");
    expect(parseDateCell("9/3/2026").value).toBe("2026-09-03");
    expect(parseDateCell("09/03/2026").value).toBe("2026-09-03");
    expect(parseDateCell("9/3/26").value).toBe("2026-09-03");
    expect(parseDateCell("").value).toBeNull();
    expect(parseDateCell("Sept 3").error).toMatch(/not a recognized date/);
    expect(parseDateCell("2026-02-30").error).toMatch(/not a valid calendar date/);
    expect(parseDateCell("13/40/2026").error).toBeDefined();
  });
});

describe("validateImportRow", () => {
  it("requires company and title", () => {
    const preview = validateImportRow(1, { company: "", title: " " });
    expect(preview.values).toBeNull();
    expect(preview.errors.map((e) => e.field)).toEqual(["company", "title"]);
  });

  it("does not coerce unknown enums or bad dates", () => {
    const preview = validateImportRow(2, {
      company: "IBM",
      title: "SWE",
      status: "Ghosted",
      priority: "urgent",
      workArrangement: "moon",
      appliedAt: "Sept 3",
      jobUrl: "ibm.com/jobs",
    });
    expect(preview.values).toBeNull();
    expect(preview.errors.map((e) => e.field).sort()).toEqual(["appliedAt", "jobUrl", "priority", "status", "workArrangement"]);
  });

  it("produces typed values and an APPLIED-without-date warning", () => {
    const preview = validateImportRow(3, {
      company: " IBM ",
      title: "SWE",
      status: "applied",
      priority: "high",
      workArrangement: "on-site",
      appliedAt: "",
      dateFound: "9/1/2026",
      note: "line1\nline2",
      jobUrl: "https://ibm.com/jobs/1",
    });
    expect(preview.errors).toEqual([]);
    expect(preview.values).toMatchObject({
      rowIndex: 3,
      company: "IBM",
      title: "SWE",
      status: "APPLIED",
      priority: "HIGH",
      workArrangement: "ONSITE",
      appliedAt: null,
      dateFound: "2026-09-01",
      note: "line1\nline2",
    });
    expect(preview.warnings[0]?.field).toBe("appliedAt");
  });
});

describe("annotateDuplicates", () => {
  const existing: DuplicateIndexEntry[] = [
    {
      applicationId: "a1",
      company: "IBM",
      normalizedCompany: "ibm",
      title: "Software Engineer",
      normalizedTitle: "software engineer",
      jobUrl: "https://ibm.com/1",
      externalJobId: "R1",
      status: "APPLIED",
    },
  ];

  it("flags matches against existing records and earlier upload rows only", () => {
    const rows = [
      validateImportRow(1, { company: "ibm", title: "software  engineer" }),
      validateImportRow(2, { company: "Datadog", title: "Backend" }),
      validateImportRow(3, { company: "Datadog", title: "backend" }),
      validateImportRow(4, { company: "Other", title: "X", jobUrl: "https://ibm.com/1" }),
      validateImportRow(5, { company: "", title: "broken" }),
    ];
    const annotated = annotateDuplicates(rows, existing);
    expect(annotated[0]!.duplicates.map((d) => d.applicationId)).toEqual(["a1"]);
    expect(annotated[0]!.duplicates[0]!.matchedOn).toEqual(["company_title"]);
    expect(annotated[1]!.duplicateOfRows).toEqual([]);
    expect(annotated[2]!.duplicateOfRows).toEqual([2]);
    expect(annotated[3]!.duplicates[0]!.matchedOn).toEqual(["job_url"]);
    expect(annotated[4]!.duplicates).toEqual([]);
    expect(isFlagged(annotated[0]!)).toBe(true);
    expect(isFlagged(annotated[1]!)).toBe(false);
    expect(isFlagged(annotated[2]!)).toBe(true);
  });

  it("external id only matches within the same company", () => {
    const rows = [
      validateImportRow(1, { company: "Other", title: "X", externalJobId: "R1" }),
      validateImportRow(2, { company: "IBM", title: "Different", externalJobId: "R1" }),
    ];
    const annotated = annotateDuplicates(rows, existing);
    expect(annotated[0]!.duplicates).toEqual([]);
    expect(annotated[1]!.duplicates[0]!.matchedOn).toEqual(["external_job_id"]);
  });
});
