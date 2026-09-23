import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCapturePatch,
  normalizeCapturedPosting,
  planCaptureUpdate,
  type CaptureFieldValues,
} from "../src/capture/index";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };

const base = {
  version: 1,
  pageUrl: "https://jobs.lever.co/acme/123",
  extractor: "lever",
};

describe("normalizeCapturedPosting", () => {
  it("rejects anything that is not a capture payload", () => {
    expect(normalizeCapturedPosting(null)).toBeNull();
    expect(normalizeCapturedPosting({ type: "other" })).toBeNull();
    expect(normalizeCapturedPosting({ ...base, version: 2 })).toBeNull();
    expect(normalizeCapturedPosting({ ...base, sneaky: "field" })).toBeNull();
  });

  it("fits values into tracker limits instead of failing the capture", () => {
    const posting = normalizeCapturedPosting({
      ...base,
      company: "  Acme\n  Robotics ",
      title: "x".repeat(500),
      description: `First paragraph.\n\n\n\n  Second   paragraph.  \n${"y".repeat(20_000)}`,
      datePosted: "2026-09-01T12:00:00Z",
      location: "Remote",
    })!;
    expect(posting.company).toBe("Acme Robotics");
    expect(posting.title).toHaveLength(200);
    expect(posting.title!.endsWith("…")).toBe(true);
    expect(posting.description!.startsWith("First paragraph.\n\nSecond paragraph.")).toBe(true);
    expect(posting.description!.length).toBeLessThanOrEqual(10_000);
    expect(posting.datePosted).toBe("2026-09-01");
  });

  it("drops unusable values rather than guessing", () => {
    const posting = normalizeCapturedPosting({
      ...base,
      jobUrl: "javascript:alert(1)",
      datePosted: "last Tuesday",
      workArrangement: "UNKNOWN",
      company: "   ",
    })!;
    // A bad jobUrl falls back to the (valid) page URL.
    expect(posting.jobUrl).toBe("https://jobs.lever.co/acme/123");
    expect(posting.datePosted).toBeNull();
    expect(posting.workArrangement).toBeNull();
    expect(posting.company).toBeNull();
  });

  it("never accepts a non-http page URL", () => {
    const posting = normalizeCapturedPosting({ ...base, pageUrl: "chrome://extensions" })!;
    expect(posting.pageUrl).toBe("");
    expect(posting.jobUrl).toBeNull();
  });
});

function captured(overrides: Partial<CaptureFieldValues> = {}): CaptureFieldValues {
  return {
    jobUrl: null,
    externalJobId: null,
    location: null,
    workArrangement: null,
    datePosted: null,
    source: null,
    description: null,
    ...overrides,
  };
}

describe("planCaptureUpdate", () => {
  async function existing(overrides: Record<string, unknown> = {}) {
    const repo = new FakeTrackerRepository();
    const services = createTrackerServices({ repository: repo, clock: fixedClock("2026-09-21") });
    const created = await services.createApplication(
      {
        requestId: randomUUID(),
        company: "Acme",
        title: "Backend Engineer",
        location: "Chicago, IL",
        source: "Referral",
        ...overrides,
      },
      OWNER,
    );
    const view = await services.getApplication({ applicationId: created.applicationId }, OWNER);
    return { services, app: view.application };
  }

  it("pre-selects blanks, never pre-selects overwrites, and skips same or missing values", async () => {
    const { app } = await existing();
    const plan = planCaptureUpdate(
      app,
      captured({
        jobUrl: "https://jobs.lever.co/acme/123",
        location: "Remote - US",
        source: "Referral",
        workArrangement: "REMOTE",
      }),
    );
    const byField = Object.fromEntries(plan.map((row) => [row.field, row]));
    expect(byField.jobUrl).toMatchObject({ change: "fill", defaultSelected: true });
    expect(byField.workArrangement).toMatchObject({ change: "fill", defaultSelected: true });
    expect(byField.location).toMatchObject({
      change: "overwrite",
      current: "Chicago, IL",
      defaultSelected: false,
      selectable: true,
    });
    expect(byField.source).toMatchObject({ change: "same", selectable: false });
    expect(byField.description).toMatchObject({ change: "missing", selectable: false });
  });

  it("treats whitespace-only differences in text as unchanged", async () => {
    const { app } = await existing({ description: "Line one.\nLine two." });
    const plan = planCaptureUpdate(app, captured({ description: "Line one.  Line two." }));
    expect(plan.find((row) => row.field === "description")!.change).toBe("same");
  });

  it("patches only explicitly selected fields and saves them through the shared service", async () => {
    const { services, app } = await existing();
    const plan = planCaptureUpdate(
      app,
      captured({ location: "Remote - US", description: "Build APIs.", externalJobId: "R-1" }),
    );
    const selected = new Set(plan.filter((row) => row.defaultSelected).map((row) => row.field));
    const patch = buildCapturePatch(plan, selected);
    expect(patch).toEqual({ description: "Build APIs.", externalJobId: "R-1" });

    const result = await services.updateApplicationDetails(
      {
        requestId: randomUUID(),
        applicationId: app.applicationId,
        expectedVersion: app.version,
        ...patch,
      },
      OWNER,
    );
    expect(result.version).toBe(app.version + 1);
    const after = await services.getApplication({ applicationId: app.applicationId }, OWNER);
    expect(after.application.location).toBe("Chicago, IL");
    expect(after.application.description).toBe("Build APIs.");
    expect(after.activity.items[0]!.type).toBe("DETAILS_UPDATED");
  });

  it("builds an empty patch when nothing is selected", async () => {
    const { app } = await existing();
    const plan = planCaptureUpdate(app, captured({ location: "Remote" }));
    expect(buildCapturePatch(plan, new Set())).toEqual({});
  });
});
