import { describe, expect, it } from "vitest";
import { JwordError } from "../src/domain/errors";
import {
  addApplicationNoteSchema,
  candidateProfileSchema,
  createApplicationSchema,
  parseOrThrow,
  searchApplicationsSchema,
  stripUndefined,
  updateApplicationDetailsSchema,
  updateApplicationNoteSchema,
  updateApplicationStatusSchema,
} from "../src/validation/schemas";

const REQ = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";

describe("createApplicationSchema", () => {
  it("accepts a minimal command and normalizes blanks to null", () => {
    const parsed = createApplicationSchema.parse({
      requestId: REQ,
      company: "  IBM ",
      title: "Engineer",
      location: "   ",
      jobUrl: "",
    });
    expect(parsed.company).toBe("IBM");
    expect(parsed.location).toBeNull();
    expect(parsed.jobUrl).toBeNull();
  });

  it("rejects unknown fields", () => {
    const result = createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", hacker: true });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID, enums, dates, and URLs", () => {
    expect(createApplicationSchema.safeParse({ requestId: "nope", company: "IBM", title: "X" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", status: "HIRED" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", priority: "URGENT" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", dateFound: "09/21/2026" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", dateFound: "2026-02-30" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", jobUrl: "ftp://x" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM", title: "X", jobUrl: "linkedin.com/jobs" }).success).toBe(false);
  });

  it("requires company and title", () => {
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: " ", title: "X" }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ requestId: REQ, company: "IBM" }).success).toBe(false);
  });
});

describe("updateApplicationStatusSchema", () => {
  it("requires a positive integer expectedVersion", () => {
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 0, status: "OA" }).success).toBe(false);
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1.5, status: "OA" }).success).toBe(false);
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "OA" }).success).toBe(true);
  });

  it("rejects unknown fields and bad timestamps", () => {
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "OA", extra: 1 }).success).toBe(false);
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "OA", occurredAt: "yesterday" }).success).toBe(false);
    expect(updateApplicationStatusSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "OA", occurredAt: "2026-09-21T10:00:00Z" }).success).toBe(true);
  });

  it("keeps explicit null appliedAt distinct from omitted", () => {
    const withNull = updateApplicationStatusSchema.parse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "APPLIED", appliedAt: null });
    expect("appliedAt" in withNull && withNull.appliedAt === null).toBe(true);
    const omitted = updateApplicationStatusSchema.parse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "APPLIED" });
    expect(omitted.appliedAt).toBeUndefined();
  });
});

describe("updateApplicationDetailsSchema", () => {
  it("rejects an update with no editable fields", () => {
    expect(updateApplicationDetailsSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1 }).success).toBe(false);
  });

  it("accepts a null-only patch (clearing a field counts as an edit)", () => {
    expect(updateApplicationDetailsSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, appliedAt: null }).success).toBe(true);
  });

  it("rejects unknown fields such as status or version", () => {
    expect(updateApplicationDetailsSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, status: "OA" }).success).toBe(false);
    expect(updateApplicationDetailsSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, version: 9 }).success).toBe(false);
  });
});

describe("note schemas", () => {
  it("requires nonblank note text", () => {
    expect(addApplicationNoteSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, note: "  " }).success).toBe(false);
    expect(addApplicationNoteSchema.safeParse({ requestId: REQ, applicationId: APP, expectedVersion: 1, note: "hi", noteDate: "2026-09-20" }).success).toBe(true);
  });

  it("rejects an empty note update", () => {
    expect(updateApplicationNoteSchema.safeParse({ requestId: REQ, applicationId: APP, noteId: APP, expectedVersion: 1 }).success).toBe(false);
    expect(updateApplicationNoteSchema.safeParse({ requestId: REQ, applicationId: APP, noteId: APP, expectedVersion: 1, noteDate: null }).success).toBe(true);
  });
});

describe("searchApplicationsSchema", () => {
  it("bounds limit and validates enums", () => {
    expect(searchApplicationsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(searchApplicationsSchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(searchApplicationsSchema.safeParse({ statuses: ["NOPE"] }).success).toBe(false);
    expect(searchApplicationsSchema.safeParse({ text: "ibm", statuses: ["SAVED"], sort: "company" }).success).toBe(true);
  });
});

describe("candidateProfileSchema", () => {
  it("validates email and urls, blanks become null", () => {
    expect(candidateProfileSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    const parsed = candidateProfileSchema.parse({ email: "", linkedinUrl: "https://linkedin.com/in/drew", phone: " " });
    expect(parsed.email).toBeNull();
    expect(parsed.phone).toBeNull();
    expect(candidateProfileSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("stripUndefined keeps null and drops undefined", () => {
    expect(stripUndefined({ a: null, b: undefined, c: 1 })).toEqual({ a: null, c: 1 });
  });

  it("parseOrThrow throws a JwordError with fieldErrors", () => {
    try {
      parseOrThrow(createApplicationSchema, { requestId: "x", company: "", title: "T" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(JwordError);
      const typed = error as JwordError;
      expect(typed.code).toBe("VALIDATION_ERROR");
      expect(typed.details.fieldErrors?.requestId).toBeDefined();
      expect(typed.details.fieldErrors?.company).toBeDefined();
      expect(typed.message).toContain("requestId");
    }
  });
});
