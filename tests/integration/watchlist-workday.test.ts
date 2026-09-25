import { afterAll, describe, expect, it } from "vitest";
import { canonicalBoardUrl, isValidBoardIdentifier, SUPPORTED_BOARD_PROVIDERS } from "@jword/core";
import { cleanupUsers, closePg, createTestUser, expectJwordError, pgQuery, rid } from "./helpers";

afterAll(async () => {
  await cleanupUsers();
  await closePg();
});

const NVIDIA = "nvidia/wd5/NVIDIAExternalCareerSite";

describe("Workday boards in the database (decision 022)", () => {
  it("derives exactly the same canonical URL as TypeScript for every provider", async () => {
    const identifiers = [
      NVIDIA,
      "acme-co/wd103/External_Careers",
      "stripe",
      "board_1.v2",
      "NVIDIA/wd5/Site",
      "nvidia/WD5/Site",
      "nvidia/wd5",
      "nvidia/wd5/Site/job",
      "nvidia/wd5/has.dot",
      "a_b/wd5/Site",
      "-acme/wd5/Site",
      "acme-/wd5/Site",
      `${"a".repeat(63)}/wd5/Site`,
      `${"a".repeat(64)}/wd5/Site`,
      `acme/wd5/${"s".repeat(100)}`,
      `acme/wd5/${"s".repeat(101)}`,
      "../x",
      "",
    ];
    for (const provider of SUPPORTED_BOARD_PROVIDERS) {
      for (const identifier of identifiers) {
        const { rows } = await pgQuery<{ url: string | null }>(
          "select jword.canonical_board_url($1::public.ats_provider, $2) url",
          [provider, identifier],
        );
        const expected = isValidBoardIdentifier(provider, identifier)
          ? canonicalBoardUrl(provider, identifier)
          : null;
        expect(rows[0]!.url, `${provider} ${identifier}`).toBe(expected);
      }
    }
  });

  it("stores a Workday board with its derived URL and enforces the shape in the table itself", async () => {
    const owner = await createTestUser("workday-store");
    const watch = await owner.services.addWatchedCompany(
      {
        requestId: rid(),
        company: "NVIDIA",
        boards: [{ provider: "WORKDAY", boardIdentifier: NVIDIA }],
      },
      owner.actor,
    );
    const { rows } = await pgQuery(
      "select id, user_id, provider::text, board_identifier, board_url from company_watch_boards where watch_id=$1",
      [watch.watchId],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        provider: "WORKDAY",
        board_identifier: NVIDIA,
        board_url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
      }),
    ]);
    expect(watch.summary).toContain("Workday");

    // Even a privileged direct write cannot store a URL that does not match the identifier.
    await expect(
      pgQuery("update company_watch_boards set board_url=$2 where id=$1", [
        rows[0]!.id,
        "https://evil.example/NVIDIAExternalCareerSite",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pgQuery("update company_watch_boards set board_identifier=$2 where id=$1", [
        rows[0]!.id,
        "nvidia",
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("treats the same Workday board in any case as already watched", async () => {
    const owner = await createTestUser("workday-unique");
    await owner.services.addWatchedCompany(
      {
        requestId: rid(),
        company: "NVIDIA",
        boards: [{ provider: "WORKDAY", boardIdentifier: NVIDIA }],
      },
      owner.actor,
    );
    await expectJwordError(
      owner.services.addWatchedCompany(
        {
          requestId: rid(),
          company: "NVIDIA Corporation",
          boards: [{ provider: "WORKDAY", boardIdentifier: "nvidia/wd5/nvidiaexternalcareersite" }],
        },
        owner.actor,
      ),
      "CONFLICT",
      "BOARD_ALREADY_WATCHED",
    );
  });
});
