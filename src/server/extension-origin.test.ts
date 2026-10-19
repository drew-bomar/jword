import { describe, expect, it } from "vitest";
import {
  checkExtensionRequest,
  extensionOrigin,
  httpStatusFor,
  parseExtensionIds,
} from "./extension-origin";

const ID = "bnjlbmpmikpggohfhmfpddeeokbjpkbk";
const STORE_ID = "abcdefghijklmnopabcdefghijklmnop";
const headers = (values: Record<string, string>) => new Headers(values);
const fromExtension = { origin: `chrome-extension://${ID}`, "content-type": "application/json" };

describe("extension API request checks", () => {
  it("lets the pinned extension through to the session check", () => {
    expect(checkExtensionRequest(headers(fromExtension), [ID])).toBeNull();
  });

  it("refuses websites, other extensions, and requests without an Origin", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost:3200",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "null",
    ]) {
      const error = checkExtensionRequest(headers({ ...fromExtension, origin }), [ID]);
      expect(error?.code).toBe("FORBIDDEN");
    }
    expect(checkExtensionRequest(headers({ "content-type": "application/json" }), [ID])?.code).toBe(
      "FORBIDDEN",
    );
  });

  it("is off unless a valid extension id is configured", () => {
    expect(checkExtensionRequest(headers(fromExtension), [])?.code).toBe("FORBIDDEN");
    expect(extensionOrigin("not-an-id")).toBeNull();
    expect(
      checkExtensionRequest(headers({ ...fromExtension, origin: "chrome-extension://not-an-id" }), [
        "not-an-id",
      ])?.code,
    ).toBe("FORBIDDEN");
  });

  it("accepts every configured extension id and nothing else (decision 027)", () => {
    const ids = parseExtensionIds(` ${ID}, ${STORE_ID},not-an-id,`, ID);
    expect(ids).toEqual([ID, STORE_ID]);
    for (const id of [ID, STORE_ID]) {
      const request = headers({ ...fromExtension, origin: `chrome-extension://${id}` });
      expect(checkExtensionRequest(request, ids)).toBeNull();
    }
    expect(parseExtensionIds(undefined, "")).toEqual([]);
  });

  it("requires a JSON body of reasonable size", () => {
    const form = { ...fromExtension, "content-type": "application/x-www-form-urlencoded" };
    expect(checkExtensionRequest(headers(form), [ID])?.code).toBe("VALIDATION_ERROR");
    const huge = { ...fromExtension, "content-length": "10000000" };
    expect(checkExtensionRequest(headers(huge), [ID])?.code).toBe("VALIDATION_ERROR");
  });

  it("maps error codes to HTTP statuses", () => {
    expect(httpStatusFor("UNAUTHENTICATED")).toBe(401);
    expect(httpStatusFor("FORBIDDEN")).toBe(403);
    expect(httpStatusFor("CONFLICT")).toBe(409);
    expect(httpStatusFor("OUTCOME_UNKNOWN")).toBe(500);
  });
});
