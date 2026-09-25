import { describe, expect, it } from "vitest";
import { mapDatabaseError, toJwordError } from "../src/index";

describe("safe outcome reporting", () => {
  it("identifies missing RPC functions as setup failures without leaking server details", () => {
    const error = mapDatabaseError(
      { code: "PGRST202", message: "private function signature", details: "private schema" },
      "delete_company_watch",
      true,
    );
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.reason).toBe("DATABASE_FUNCTION_UNAVAILABLE");
    expect(error.message).toContain("database update");
    expect(error.message).not.toMatch(/private|unconfirmed|request ID/);
  });
  it("does not claim rollback when the database response is lost", () => {
    const error = mapDatabaseError(
      { code: "", message: "fetch failed: private data" },
      "create",
      true,
    );
    expect(error.code).toBe("OUTCOME_UNKNOWN");
    expect(error.message).not.toMatch(/not saved|private data/);
    expect(toJwordError(new Error("lost response")).message).not.toMatch(
      /not saved|nothing changed/i,
    );
  });
  it("treats rejected authentication claims as a confirmed rejection", () => {
    expect(mapDatabaseError({ code: "PGRST303" }, "save", true).code).toBe("UNAUTHENTICATED");
  });
  it("keeps known database rejections distinct and hides raw database text", () => {
    const error = mapDatabaseError({ code: "23514", message: "sensitive row" }, "save", true);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).not.toContain("sensitive");
    expect(
      mapDatabaseError({ code: "JW409", hint: "STALE_VERSION", message: "Refresh" }, "save").reason,
    ).toBe("STALE_VERSION");
  });
});
