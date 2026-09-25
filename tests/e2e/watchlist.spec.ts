import { randomUUID } from "node:crypto";
import { EXTENSION_ORIGIN } from "./helpers/extension";
import type { Page } from "@playwright/test";
import { createApplication, expect, test } from "./helpers/auth";

// Board discovery answers from E2E_FIXTURE_BOARDS (JWORD_BOARD_DIRECTORY=fixtures in the
// Playwright web server), so these tests never call Greenhouse, Lever, Ashby, or Workday.

async function openAdd(page: Page) {
  await page.getByRole("button", { name: "Add company" }).first().click();
  return page.getByRole("dialog", { name: "Add to watchlist" });
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("dialog").getByLabel(label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("company watchlist", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop flow; mobile covered below");

  test("changing companies clears boards, including results from an older lookup", async ({
    page,
  }) => {
    await createApplication(page, { company: "Stripe", title: "Engineer" });
    await page.goto("/watchlist");
    const dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Stripe");
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();
    await dialog
      .getByTestId("board-suggestion")
      .filter({ hasText: "Lever" })
      .getByRole("checkbox")
      .uncheck();
    const lookup = page.waitForResponse((response) =>
      response.url().includes("/api/watchlist/boards?companyId="),
    );
    await dialog
      .getByRole("list", { name: "Existing companies" })
      .getByRole("button", { name: "Stripe", exact: true })
      .click();
    await lookup;
    await expect(dialog.getByText("Selected (1/3)")).toBeVisible();
    await expect(
      dialog.getByTestId("board-suggestion").filter({ hasText: "Lever" }).getByRole("checkbox"),
    ).not.toBeChecked();
    await dialog.getByRole("button", { name: "Change", exact: true }).click();
    await dialog.getByLabel("Company *").fill("Ramp");
    await expect(dialog.getByText("Selected (0/3)")).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Selected boards" })).toHaveText("Ashby ramp");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    const row = page.getByTestId("watch-row").filter({ hasText: "Ramp" });
    await expect(row.getByRole("link", { name: "Open Ramp Ashby board" })).toBeVisible();
    await expect(row).not.toContainText("stripe");
  });

  test("an in-flight lookup cannot populate a different company or block saving", async ({
    page,
  }) => {
    await page.goto("/watchlist");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route("**/api/watchlist/boards?**", async (route) => {
      started();
      await gate;
      await route
        .fulfill({
          json: {
            ok: true,
            data: {
              company: "Stripe",
              companyId: null,
              candidates: ["stripe"],
              ownershipChecked: true,
              unavailable: [],
              incomplete: [],
              warnings: [],
              suggestions: [
                {
                  provider: "GREENHOUSE",
                  boardIdentifier: "stripe",
                  boardUrl: "https://job-boards.greenhouse.io/stripe",
                  confidence: "high",
                  reasons: ["Name matches"],
                  boardName: "Stripe",
                  openJobs: 1,
                  openJobsAtLeast: false,
                  sampleTitles: [],
                  fromApplications: false,
                  watchedBy: null,
                },
              ],
            },
          },
        })
        .catch(() => {}); // The client may have already aborted this old read.
    });
    const dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Stripe");
    await requested;
    await dialog.getByLabel("Company *").fill("Different Company");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    try {
      await expect(dialog).toBeHidden({ timeout: 5_000 });
      const row = page.getByTestId("watch-row").filter({ hasText: "Different Company" });
      await expect(row).toContainText("No board yet");
    } finally {
      release();
    }
  });

  test("transport failures leave lookup and suggestions retryable", async ({ page }) => {
    await page.goto("/watchlist");
    let failed = false;
    await page.route("**/api/watchlist/boards?**", async (route) => {
      if (!failed) {
        failed = true;
        await route.abort("failed");
      } else await route.continue();
    });
    const dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Stripe");
    await expect(dialog.getByText(/Could not load this lookup/)).toBeVisible();
    await dialog.getByRole("button", { name: "Search again" }).click();
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.route("**/api/watchlist/suggestions?**", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Suggest from applications" }).first().click();
    const suggestions = page.getByRole("dialog", { name: "Suggest from applications" });
    await expect(suggestions.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.unroute("**/api/watchlist/suggestions?**");
    await suggestions.getByRole("button", { name: "Try again" }).click();
    await expect(suggestions.getByText(/No suggestions/)).toBeVisible();
  });

  test("a lost reactivation response only permits retrying that reactivation", async ({ page }) => {
    await page.goto("/watchlist");
    let dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Retry Watch");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByTestId("watch-row").filter({ hasText: "Retry Watch" });
    await row.getByRole("button", { name: "Deactivate Retry Watch" }).click();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Retry Watch");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog.getByRole("button", { name: "Reactivate it" })).toBeVisible();
    let dropped = false;
    await page.route("**/watchlist", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Reactivate it" }).click();
    await expect(dialog.getByRole("button", { name: "Retry reactivation" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add to watchlist" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Retry reactivation" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("watch-row")).toHaveCount(1);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
  });

  test("watchlist read endpoints return private JSON errors for signed-out callers", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      for (const endpoint of ["boards?company=Stripe", "companies?text=Stripe", "suggestions"]) {
        const response = await context.request.get(
          `http://localhost:3100/api/watchlist/${endpoint}`,
        );
        expect(response.status()).toBe(401);
        expect(response.headers()["cache-control"]).toContain("no-store");
        expect(await response.json()).toMatchObject({
          ok: false,
          error: { code: "UNAUTHENTICATED" },
        });
      }
    } finally {
      await context.close();
    }
  });

  test("adding a company finds its boards; edit, stale edit, deactivate, duplicate, reactivate", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Watchlist" }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
    await expect(page.getByText("No watched companies yet")).toBeVisible();

    // Typing the company is enough: boards are looked up and strong matches are ticked.
    let dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Stripe");
    const found = dialog.getByRole("list", { name: "Found boards" });
    const greenhouse = found.getByTestId("board-suggestion").filter({ hasText: "Greenhouse" });
    const lever = found.getByTestId("board-suggestion").filter({ hasText: "Lever" });
    await expect(greenhouse).toContainText("Strong match");
    await expect(greenhouse).toContainText("689 open jobs");
    await expect(greenhouse).toContainText("Board name “Stripe” matches");
    await expect(greenhouse.getByRole("checkbox")).toBeChecked();
    await expect(lever.getByRole("checkbox")).toBeChecked();
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();

    // The owner stays in control: untick Lever, add a careers page by URL.
    await lever.getByRole("checkbox").click();
    await dialog.getByLabel("Add a board by URL").fill("https://stripe.com/jobs");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    const selected = dialog.getByRole("list", { name: "Selected boards" });
    await expect(selected.getByRole("listitem")).toHaveText([
      "Greenhouse stripe",
      "Careers page https://stripe.com/jobs",
    ]);
    await choose(page, "Interest", "4");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByTestId("watch-row").filter({ hasText: "Stripe" });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("link", { name: "Open Stripe Greenhouse board" })).toHaveAttribute(
      "href",
      "https://job-boards.greenhouse.io/stripe",
    );
    await expect(row.getByRole("link", { name: "Open Stripe careers page" })).toHaveAttribute(
      "href",
      "https://stripe.com/jobs",
    );
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByText("4/5")).toBeVisible();
    await expect(
      row.getByText(/Started watching Stripe \(Greenhouse stripe, careers page\) · You/),
    ).toBeVisible();

    // Edit: swap the careers page for the Lever board found by "Find boards".
    await row.getByRole("button", { name: "Edit Stripe" }).click();
    dialog = page.getByRole("dialog", { name: "Edit Stripe" });
    await dialog.getByRole("button", { name: /^Remove Careers page/ }).click();
    await dialog.getByRole("button", { name: "Find boards" }).click();
    await dialog
      .getByTestId("board-suggestion")
      .filter({ hasText: "Lever" })
      .getByRole("checkbox")
      .click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("link", { name: "Open Stripe Lever board" })).toBeVisible();
    await expect(row.getByRole("link", { name: "Open Stripe careers page" })).toHaveCount(0);
    await expect(row.getByText(/Updated watch for Stripe/)).toBeVisible();

    // Stale edit: tab B opens the editor, tab A deactivates, tab B keeps its draft.
    const tabB = await page.context().newPage();
    await tabB.goto("/watchlist");
    await tabB.getByRole("button", { name: "Edit Stripe" }).click();
    const dialogB = tabB.getByRole("dialog", { name: "Edit Stripe" });
    await dialogB.getByLabel("Website").fill("https://stripe.com");

    await row.getByRole("button", { name: "Deactivate Stripe" }).click();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();

    await dialogB.getByRole("button", { name: "Save changes" }).click();
    await expect(dialogB.getByText("This watch changed since you opened it.")).toBeVisible();
    await expect(dialogB.getByLabel("Website")).toHaveValue("https://stripe.com");
    await dialogB.getByRole("button", { name: "Refresh latest values" }).click();
    await dialogB.getByRole("button", { name: "Reapply my edits" }).click();
    await dialogB.getByRole("button", { name: "Save changes" }).click();
    await expect(dialogB).toBeHidden();
    await tabB.close();

    // Duplicate: found boards are marked as taken, and saving offers reactivation.
    dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("  stripe ");
    const taken = dialog.getByTestId("board-suggestion").filter({ hasText: "Greenhouse" });
    await expect(taken).toContainText("Already watched for Stripe");
    await expect(taken.getByRole("checkbox")).toBeDisabled();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    const already = dialog.getByRole("alert").filter({ hasText: "Already on your watchlist" });
    await expect(already).toContainText("Stripe is already on your watchlist (inactive).");
    await already.getByRole("button", { name: "Reactivate it" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("watch-row")).toHaveCount(1);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByText(/Resumed watching Stripe/)).toBeVisible();

    await page.goto("/watchlist?provider=LEVER");
    await expect(page.getByTestId("watch-row")).toHaveCount(1);
    await page.goto("/watchlist?provider=ASHBY");
    await expect(page.getByText("No matching companies")).toBeVisible();
  });

  test("weaker matches stay unticked, and a company holds at most three boards", async ({
    page,
  }) => {
    await page.goto("/watchlist");
    const dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Notion");
    const ashby = dialog.getByTestId("board-suggestion").filter({ hasText: "Ashby" });
    const lever = dialog.getByTestId("board-suggestion").filter({ hasText: "Lever" });
    await expect(ashby).toContainText("Strong match");
    await expect(ashby.getByRole("checkbox")).toBeChecked();
    await expect(lever).toContainText("Possible match");
    await expect(lever).toContainText("Board name “Notion Hardware Co.” is similar");
    await expect(lever.getByRole("checkbox")).not.toBeChecked();

    await lever.getByRole("checkbox").click();
    await dialog
      .getByLabel("Add a board by URL")
      .fill("https://boards.greenhouse.io/notion/jobs/1");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("Selected (3/3)")).toBeVisible();
    await dialog.getByLabel("Add a board by URL").fill("https://notion.so/careers");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("A company can have at most 3 boards.")).toBeVisible();
    await dialog.getByRole("button", { name: /^Remove Lever notion/ }).click();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByTestId("watch-row").filter({ hasText: "Notion" });
    await expect(
      row.getByText(/Started watching Notion \(Ashby notion, Greenhouse notion\)/),
    ).toBeVisible();
  });

  test("a pasted Workday posting link becomes its board and is checked, never guessed", async ({
    page,
  }) => {
    await page.goto("/watchlist");
    const dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("Acme");
    await expect(dialog.getByText(/Workday boards are not guessed/)).toBeVisible();
    await dialog
      .getByLabel("Add a board by URL")
      .fill(
        "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Firmware-Engineer_JR1?source=LinkedIn",
      );
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    const workday = dialog.getByTestId("board-suggestion").filter({ hasText: "Workday" });
    await expect(workday).toContainText("acme/wd5/External");
    await expect(workday).toContainText("2000+ open jobs");
    await expect(workday).toContainText("Checked from your link");
    await expect(workday.getByRole("checkbox")).toBeChecked();
    await expect(dialog.getByText("Selected (1/3)")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByTestId("watch-row").filter({ hasText: "Acme" });
    await expect(
      row.getByText(/Started watching Acme \(Workday acme\/wd5\/External\)/),
    ).toBeVisible();
  });

  test("upgrading an old Other link preserves a full three-board selection", async ({ page }) => {
    const response = await page.request.post("/api/extension/add-watch", {
      headers: { Origin: EXTENSION_ORIGIN },
      data: {
        requestId: randomUUID(),
        company: "Acme",
        boards: [
          {
            provider: "OTHER",
            boardUrl:
              "https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/Engineer_JR1",
          },
          { provider: "LEVER", boardIdentifier: "acme" },
          { provider: "ASHBY", boardIdentifier: "acme" },
        ],
      },
    });
    expect(response.ok()).toBe(true);
    await page.goto("/watchlist");
    await page.getByRole("button", { name: "Edit Acme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Acme" });
    await expect(dialog.getByText("Selected (3/3)")).toBeVisible();
    const checked = page.waitForResponse(
      (reply) =>
        reply.url().includes("/api/watchlist/boards?") &&
        new URL(reply.url()).searchParams.get("mode") === "verify",
    );
    await dialog.getByRole("button", { name: "Use Workday board", exact: true }).click();
    const data = await (await checked).json();
    expect(data.data.candidates).toEqual([]);
    expect(data.data.suggestions).toHaveLength(1);
    await expect(dialog.getByText("Selected (3/3)")).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Selected boards" })).toContainText(
      "Workday acme/wd5/External",
    );
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Edit Acme", exact: true }).click();
    await expect(dialog.getByText("Selected (3/3)")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Use Workday board", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("list", { name: "Selected boards" })).toContainText(
      "Workday acme/wd5/External",
    );
  });

  test("suggestions from applications watch companies you applied to in one step", async ({
    page,
  }) => {
    await page.goto("/applications/new");
    await page.getByLabel("Company *").fill("Datadog");
    await page.getByLabel("Role *").fill("Backend Engineer");
    await page.getByLabel("Job URL").fill("https://job-boards.greenhouse.io/datadog/jobs/42");
    await page.getByRole("button", { name: "Add application" }).click();
    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);

    await page.goto("/watchlist");
    await page.getByRole("button", { name: "Suggest from applications" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Suggest from applications" });
    const item = dialog.getByTestId("application-suggestion").filter({ hasText: "Datadog" });
    await expect(item).toContainText("Greenhouse datadog · 1 application");
    await expect(item.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("button", { name: "Watch 1 company" }).click();
    await expect(item).toContainText("Watching");
    await dialog.getByRole("button", { name: "Done" }).click();

    const row = page.getByTestId("watch-row").filter({ hasText: "Datadog" });
    await expect(row.getByRole("link", { name: "Open Datadog Greenhouse board" })).toBeVisible();
    await row.getByRole("link", { name: "1 application" }).click();
    await expect(page).toHaveURL(/\/\?q=Datadog$/);
    await expect(page.getByTestId("application-row")).toHaveCount(1);
  });
});

test("mobile: watched companies render as cards and can be deactivated", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/watchlist");
  const dialog = await openAdd(page);
  await dialog.getByLabel("Company *").fill("Ramp");
  await expect(
    dialog.getByTestId("board-suggestion").filter({ hasText: "Ashby" }).getByRole("checkbox"),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByTestId("watch-card").filter({ hasText: "Ramp" });
  await expect(card.getByText("Ashby", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Deactivate Ramp" }).click();
  await expect(card.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Reactivate Ramp" })).toBeVisible();
});
