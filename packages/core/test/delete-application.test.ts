import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../src/domain/actor";
import { fixedClock } from "../src/domain/dates";
import { JwordError } from "../src/domain/errors";
import { createFixtureJobCollector, fixturePosting } from "../src/collection/fixtures";
import { createTrackerServices } from "../src/services/index";
import { FakeTrackerRepository } from "../src/testing/fake-repository";

const OWNER: ActorContext = { userId: "11111111-1111-4111-8111-111111111111", actorType: "USER" };
const OTHER: ActorContext = { userId: "22222222-2222-4222-8222-222222222222", actorType: "USER" };

async function expectError(promise: Promise<unknown>, code: string, reason?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JwordError);
  expect((error as JwordError).code).toBe(code);
  if (reason) expect((error as JwordError).details.reason).toBe(reason);
}

function setup() {
  const repo = new FakeTrackerRepository();
  const services = createTrackerServices({
    repository: repo,
    clock: fixedClock("2026-09-25"),
    jobCollector: createFixtureJobCollector({
      GREENHOUSE: {
        acme: {
          status: "complete",
          reason: null,
          reportedTotal: null,
          postings: [fixturePosting("https://job-boards.greenhouse.io/acme/jobs", "1", "Engineer")],
        },
      },
    }),
  });
  return { repo, services };
}

describe("delete application (decision 025)", () => {
  it("requires confirmation, the current version, and ownership", async () => {
    const { services } = setup();
    const app = await services.createApplication(
      { requestId: randomUUID(), company: "Acme", title: "Engineer", initialNote: "hi" },
      OWNER,
    );
    const command = {
      requestId: randomUUID(),
      applicationId: app.applicationId,
      expectedVersion: 1,
    };
    await expectError(services.deleteApplication(command, OWNER), "VALIDATION_ERROR");
    await expectError(
      services.deleteApplication({ ...command, confirmed: false }, OWNER),
      "VALIDATION_ERROR",
    );
    await expectError(
      services.deleteApplication({ ...command, expectedVersion: 2, confirmed: true }, OWNER),
      "CONFLICT",
      "STALE_VERSION",
    );
    await expectError(
      services.deleteApplication({ ...command, confirmed: true }, OTHER),
      "NOT_FOUND",
      "APPLICATION_NOT_FOUND",
    );
  });

  it("removes the application, job, notes, and history; keeps the company; replays safely", async () => {
    const { repo, services } = setup();
    const app = await services.createApplication(
      { requestId: randomUUID(), company: "Acme", title: "Engineer", initialNote: "hi" },
      OWNER,
    );
    const command = {
      requestId: randomUUID(),
      applicationId: app.applicationId,
      expectedVersion: 1,
      confirmed: true,
    };
    const deleted = await services.deleteApplication(command, OWNER);
    expect(deleted).toMatchObject({
      deleted: true,
      applicationId: app.applicationId,
      replayed: false,
    });
    expect(repo.applications).toHaveLength(0);
    expect(repo.jobs).toHaveLength(0);
    expect(repo.notes).toHaveLength(0);
    expect(repo.activities).toHaveLength(0);
    expect(repo.companies.map((c) => c.name)).toEqual(["Acme"]);
    // A lost response retried with the same request id confirms instead of failing.
    expect(await services.deleteApplication(command, OWNER)).toMatchObject({
      deleted: true,
      replayed: true,
    });
    await expectError(
      services.getApplication({ applicationId: app.applicationId }, OWNER),
      "NOT_FOUND",
    );
  });

  it("returns the lead it came from to New so it can be created again", async () => {
    const { repo, services } = setup();
    const watch = await services.addWatchedCompany(
      {
        requestId: randomUUID(),
        company: "Acme",
        boards: [{ provider: "GREENHOUSE", boardIdentifier: "acme" }],
      },
      OWNER,
    );
    await services.checkForNewJobs({ watchId: watch.watchId }, OWNER);
    const [lead] = (await services.listLeads({}, OWNER)).items;
    const promoted = await services.createApplicationFromLead(
      { requestId: randomUUID(), leadId: lead!.leadId, expectedVersion: 1 },
      OWNER,
    );
    const deleted = await services.deleteApplication(
      {
        requestId: randomUUID(),
        applicationId: promoted.applicationId,
        expectedVersion: 1,
        confirmed: true,
      },
      OWNER,
    );
    expect(deleted.restoredLeadIds).toEqual([lead!.leadId]);
    const after = await services.getLead({ leadId: lead!.leadId }, OWNER);
    expect(after).toMatchObject({ reviewStatus: "NEW", applicationId: null, version: 3 });
    expect(repo.leadActivities.map((a) => a.type)).toEqual(["LEAD_PROMOTED", "LEAD_RESTORED"]);
    const again = await services.createApplicationFromLead(
      { requestId: randomUUID(), leadId: lead!.leadId, expectedVersion: 3 },
      OWNER,
    );
    expect(again.reviewStatus).toBe("PROMOTED");
  });
});
