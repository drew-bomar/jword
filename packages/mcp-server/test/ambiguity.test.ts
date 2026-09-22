import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUniqueMatch, type ApplicationSummary, type Page } from "@jword/core";
import { createHarness, OWNER_ID, type Harness } from "./helpers";

/**
 * A scripted "agent" that follows the documented protocol exactly:
 * search -> resolveUniqueMatch -> mutate only on a unique, complete match; otherwise ask/report.
 */
async function scriptedAgent(
  h: Harness,
  request: { text: string; status: string; limit?: number },
) {
  const mutate = vi.fn(async (applicationId: string, version: number) =>
    h.call("update_application_status", {
      requestId: crypto.randomUUID(),
      applicationId,
      expectedVersion: version,
      status: request.status,
    }),
  );
  const search = await h.call("search_applications", {
    text: request.text,
    ...(request.limit ? { limit: request.limit } : {}),
  });
  const page: Page<ApplicationSummary> = {
    items: search.body.items as ApplicationSummary[],
    hasMore: Boolean(search.body.hasMore),
    nextCursor: (search.body.nextCursor as string | null) ?? null,
  };
  const resolution = resolveUniqueMatch(page);
  if (resolution.kind === "unique") {
    const result = await mutate(resolution.match.applicationId, resolution.match.version);
    return {
      resolution,
      mutate,
      reply: `Updated ${resolution.match.company} ${resolution.match.title}: ${result.body.summary}`,
    };
  }
  if (resolution.kind === "ambiguous") {
    const choices = resolution.candidates.map((c) => `${c.company} - ${c.title} (${c.status})`);
    return { resolution, mutate, reply: `Which one did you mean? ${choices.join("; ")}` };
  }
  return {
    resolution,
    mutate,
    reply: "I couldn't find a matching application. Want me to create one?",
  };
}

describe("ambiguity protocol (no mutation before clarification)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    await h.seed(OWNER_ID, { company: "IBM", title: "Software Engineer", status: "APPLIED" });
    await h.seed(OWNER_ID, { company: "IBM", title: "Backend Engineer", status: "SAVED" });
    await h.seed(OWNER_ID, { company: "Datadog", title: "Backend Engineer", status: "APPLIED" });
  });
  afterEach(async () => {
    await h.close();
  });

  it("asks a clarifying question when two applications match and mutates nothing", async () => {
    const activitiesBefore = h.repo.activities.length;
    const { resolution, mutate, reply } = await scriptedAgent(h, {
      text: "IBM",
      status: "INTERVIEW",
    });
    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind === "ambiguous") {
      expect(resolution.candidates.map((c) => c.title).sort()).toEqual([
        "Backend Engineer",
        "Software Engineer",
      ]);
      expect(resolution.truncated).toBe(false);
    }
    expect(mutate).not.toHaveBeenCalled();
    expect(reply).toMatch(/Which one/);
    expect(h.repo.activities.length).toBe(activitiesBefore);
    expect(h.repo.applications.every((a) => a.status !== "INTERVIEW")).toBe(true);
  });

  it("treats a truncated page with one visible candidate as ambiguous", async () => {
    const activitiesBefore = h.repo.activities.length;
    const { resolution, mutate } = await scriptedAgent(h, {
      text: "IBM",
      status: "INTERVIEW",
      limit: 1,
    });
    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind === "ambiguous") {
      expect(resolution.candidates).toHaveLength(1);
      expect(resolution.truncated).toBe(true);
    }
    expect(mutate).not.toHaveBeenCalled();
    expect(h.repo.activities.length).toBe(activitiesBefore);
  });

  it("mutates exactly once when the match is unique", async () => {
    const { resolution, mutate, reply } = await scriptedAgent(h, {
      text: "Datadog",
      status: "INTERVIEW",
    });
    expect(resolution.kind).toBe("unique");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(reply).toMatch(/Updated Datadog Backend Engineer/);
    const datadog = h.repo.applications.find(
      (a) =>
        h.repo.jobs.find((j) => j.id === a.jobId)?.title === "Backend Engineer" &&
        a.status === "INTERVIEW",
    );
    expect(datadog).toBeDefined();
    expect(
      h.repo.activities.filter((a) => a.type === "STATUS_CHANGED" && a.actorType === "CODEX"),
    ).toHaveLength(1);
  });

  it("reports zero matches without inventing a record or UUID", async () => {
    const before = h.repo.applications.length;
    const { resolution, mutate, reply } = await scriptedAgent(h, {
      text: "Nonexistent Corp",
      status: "REJECTED",
    });
    expect(resolution.kind).toBe("none");
    expect(mutate).not.toHaveBeenCalled();
    expect(reply).toMatch(/couldn't find/);
    expect(h.repo.applications.length).toBe(before);
  });
});
