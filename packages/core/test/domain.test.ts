import { describe, expect, it } from "vitest";
import { createClock, fixedClock, isIsoDate, resolveTimeZone, todayInTimeZone } from "../src/domain/dates";
import { cleanText, normalizeName } from "../src/domain/normalize";
import { resolveUniqueMatch } from "../src/domain/match";
import { safeMutationResult } from "../src/services/index";
import type { ApplicationSummary, MutationResult } from "../src/domain/types";

describe("todayInTimeZone", () => {
  it("uses Central time, not UTC, around midnight", () => {
    // 2026-09-22 04:30Z is 2026-09-21 23:30 CDT
    expect(todayInTimeZone("America/Chicago", new Date("2026-09-22T04:30:00Z"))).toBe("2026-09-21");
    // 2026-09-22 05:30Z is 2026-09-22 00:30 CDT
    expect(todayInTimeZone("America/Chicago", new Date("2026-09-22T05:30:00Z"))).toBe("2026-09-22");
  });

  it("handles daylight saving boundaries", () => {
    // Spring forward 2026-03-08 at 2am CST. 07:30Z = 01:30 CST.
    expect(todayInTimeZone("America/Chicago", new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08");
    // 05:30Z on 2026-03-08 is 23:30 CST on 03-07.
    expect(todayInTimeZone("America/Chicago", new Date("2026-03-08T05:30:00Z"))).toBe("2026-03-07");
    // Fall back 2026-11-01. 05:30Z = 00:30 CDT on 11-01; 06:30Z = 00:30 CST on 11-01 after fallback? 06:30Z = 01:30 CDT / 00:30 CST -> still 11-01.
    expect(todayInTimeZone("America/Chicago", new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    // 2026-11-02 05:30Z = 2026-11-01 23:30 CST (offset now -6)
    expect(todayInTimeZone("America/Chicago", new Date("2026-11-02T05:30:00Z"))).toBe("2026-11-01");
  });

  it("clock helpers", () => {
    expect(fixedClock("2026-09-21").today()).toBe("2026-09-21");
    expect(resolveTimeZone(undefined)).toBe("America/Chicago");
    expect(resolveTimeZone("Europe/London")).toBe("Europe/London");
    expect(() => resolveTimeZone("Mars/Olympus")).toThrow();
    expect(createClock("America/Chicago").today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isIsoDate", () => {
  it("accepts real dates and rejects impossible or malformed ones", () => {
    expect(isIsoDate("2026-09-21")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("9/21/2026")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
  });
});

describe("normalizeName", () => {
  it("folds case and whitespace only", () => {
    expect(normalizeName("  IBM ")).toBe("ibm");
    expect(normalizeName("Acme   Corp\tInc.")).toBe("acme corp inc.");
    expect(normalizeName("ibm")).toBe(normalizeName("IBM"));
  });

  it("preserves punctuation and legal suffixes", () => {
    expect(normalizeName("Acme Inc.")).not.toBe(normalizeName("Acme"));
    expect(normalizeName("Acme, Inc.")).toBe("acme, inc.");
    expect(normalizeName(null)).toBe("");
  });

  it("cleanText trims and blanks to null", () => {
    expect(cleanText("  x ")).toBe("x");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

const summary = (id: string): ApplicationSummary => ({
  applicationId: id,
  company: "IBM",
  title: "SWE",
  status: "SAVED",
  priority: "MEDIUM",
  version: 1,
  location: null,
  appliedAt: null,
  lastActivityAt: "2026-09-21T00:00:00Z",
});

describe("resolveUniqueMatch", () => {
  it("none / unique / ambiguous", () => {
    expect(resolveUniqueMatch({ items: [], hasMore: false, nextCursor: null })).toEqual({ kind: "none" });
    expect(resolveUniqueMatch({ items: [summary("a")], hasMore: false, nextCursor: null })).toMatchObject({ kind: "unique" });
    expect(resolveUniqueMatch({ items: [summary("a"), summary("b")], hasMore: false, nextCursor: null })).toMatchObject({ kind: "ambiguous", truncated: false });
  });

  it("a single item on a truncated page is not unique", () => {
    expect(resolveUniqueMatch({ items: [summary("a")], hasMore: true, nextCursor: "x" })).toMatchObject({ kind: "ambiguous", truncated: true });
  });
});

describe("safeMutationResult", () => {
  it("keeps only safe scalar fields in before/after", () => {
    const result: MutationResult = {
      ok: true,
      operation: "update_application_details",
      requestId: "r",
      replayed: false,
      noop: false,
      summary: "x",
      changedFields: ["priority", "referral", "location"],
      before: { priority: "LOW", referral: "Jane Doe", location: "Austin" },
      after: { priority: "HIGH", referral: "John", location: "Dallas", appliedAt: "2026-01-01" },
    };
    const safe = safeMutationResult(result);
    expect(safe.before).toEqual({ priority: "LOW" });
    expect(safe.after).toEqual({ priority: "HIGH", appliedAt: "2026-01-01" });
    expect(safe.changedFields).toEqual(["priority", "referral", "location"]);
  });
});
