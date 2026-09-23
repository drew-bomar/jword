import { describe, expect, it } from "vitest";
import { checkExtensionRequest, extensionOrigin, httpStatusFor } from "./extension-origin";

const ID = "bnjlbmpmikpggohfhmfpddeeokbjpkbk";
const headers = (values: Record<string, string>) => new Headers(values);
const fromExtension = { origin: `chrome-extension://${ID}`, "content-type": "application/json" };

describe("extension API request checks", () => {
  it("lets the pinned extension through to the session check", () => {
    expect(checkExtensionRequest(headers(fromExtension), ID)).toBeNull();
  });

  it("refuses websites, other extensions, and requests without an Origin", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost:3200",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "null",
    ]) {
      const error = checkExtensionRequest(headers({ ...fromExtension, origin }), ID);
      expect(error?.code).toBe("FORBIDDEN");
    }
    expect(checkExtensionRequest(headers({ "content-type": "application/json" }), ID)?.code).toBe(
      "FORBIDDEN",
    );
  });

  it("is off unless a valid extension id is configured", () => {
    expect(checkExtensionRequest(headers(fromExtension), null)?.code).toBe("FORBIDDEN");
    expect(extensionOrigin("not-an-id")).toBeNull();
    expect(
      checkExtensionRequest(
        headers({ ...fromExtension, origin: "chrome-extension://not-an-id" }),
        "not-an-id",
      )?.code,
    ).toBe("FORBIDDEN");
  });

  it("requires a JSON body of reasonable size", () => {
    const form = { ...fromExtension, "content-type": "application/x-www-form-urlencoded" };
    expect(checkExtensionRequest(headers(form), ID)?.code).toBe("VALIDATION_ERROR");
    const huge = { ...fromExtension, "content-length": "10000000" };
    expect(checkExtensionRequest(headers(huge), ID)?.code).toBe("VALIDATION_ERROR");
  });

  it("maps error codes to HTTP statuses", () => {
    expect(httpStatusFor("UNAUTHENTICATED")).toBe(401);
    expect(httpStatusFor("FORBIDDEN")).toBe(403);
    expect(httpStatusFor("CONFLICT")).toBe(409);
    expect(httpStatusFor("OUTCOME_UNKNOWN")).toBe(500);
  });
});
