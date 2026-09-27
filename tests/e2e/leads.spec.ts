import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/auth";

// Collection answers from E2E_FIXTURE_POSTINGS (JWORD_BOARD_DIRECTORY=fixtures), so these tests
// never call real providers. Stripe has complete Greenhouse and Lever boards; the Acme Workday
// board is at Workday's reporting cap, so its scan is partial.

async function watch(page: Page, company: string, boardUrl?: string) {
  await page.goto("/watchlist");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add to watchlist" });
  await dialog.getByLabel("Company *").fill(company);
  if (boardUrl) {
    await dialog.getByLabel("Add a board by URL").fill(boardUrl);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByTestId("board-suggestion").first()).toBeVisible();
  } else {
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("leads inbox", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop flow; mobile covered below");

  test("check for new jobs, dismiss and restore, and create an application", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByText("Watch companies first")).toBeVisible();

    await watch(page, "Stripe");
    await page.getByRole("link", { name: "Leads" }).click();
    await expect(page.getByText("Check for new jobs to read")).toBeVisible();
    await page.getByRole("button", { name: "Check for new jobs" }).click();

    const summary = page.getByTestId("check-summary");
    await expect(summary).toContainText("Checked 2 boards: 3 new leads, 0 updated");
    await expect(summary.getByTestId("check-board")).toHaveCount(2);
    const rows = page.getByTestId("lead-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Backend Engineer" })).toContainText("San Francisco, CA");
    await expect(
      rows.filter({ hasText: "Backend Engineer" }).getByRole("link", { name: /Open posting/ }),
    ).toHaveAttribute("href", "https://job-boards.greenhouse.io/stripe/jobs/1001");

    // A second check finds nothing new and does not duplicate rows.
    await page.getByRole("button", { name: "Check for new jobs" }).click();
    await expect(summary).toContainText("0 new leads, 0 updated");
    await expect(rows).toHaveCount(3);

    // Dismiss hides a lead from New; the Dismissed filter shows it; Restore brings it back.
    await rows
      .filter({ hasText: "Account Executive" })
      .getByRole("button", { name: "Dismiss Account Executive" })
      .click();
    await expect(rows).toHaveCount(2);
    await page.getByLabel("Filter by review status").click();
    await page.getByRole("option", { name: "Dismissed" }).click();
    await expect(page).toHaveURL(/status=dismissed/);
    await expect(rows).toHaveCount(1);
    await rows.getByRole("button", { name: "Restore Account Executive" }).click();
    await expect(page.getByText("No matching leads")).toBeVisible();

    // Create application: one Saved application linked to the lead.
    await page.goto("/leads");
    await rows
      .filter({ hasText: "Backend Engineer" })
      .getByRole("button", { name: "Create application for Backend Engineer" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create application" });
    await dialog.getByRole("button", { name: "Create application" }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(2);
    await page.goto("/leads?status=promoted");
    await rows.getByRole("link", { name: "View application" }).click();
    await expect(page.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();
    await expect(page.getByText("Greenhouse", { exact: true })).toBeVisible();
  });

  test("a duplicate application needs confirmation before it is created", async ({ page }) => {
    await watch(page, "Stripe");
    await page.goto("/applications/new");
    await page.getByLabel("Company *").fill("Stripe");
    await page.getByLabel("Role *").fill("Solutions Architect");
    await page.getByRole("button", { name: "Add application" }).click();
    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);

    await page.goto("/leads");
    await page.getByRole("button", { name: "Check for new jobs" }).click();
    const row = page.getByTestId("lead-row").filter({ hasText: "Solutions Architect" });
    await row.getByRole("button", { name: "Create application for Solutions Architect" }).click();
    const dialog = page.getByRole("dialog", { name: "Create application" });
    await dialog.getByRole("button", { name: "Create application" }).click();
    await expect(dialog.getByText("Possible duplicate")).toBeVisible();
    await dialog.getByRole("button", { name: "Create anyway" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
  });

  test("a partial Workday scan and a careers page are reported from the watchlist", async ({
    page,
  }) => {
    await watch(page, "Acme", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/X_JR1");
    const row = page.getByTestId("watch-row").filter({ hasText: "Acme" });
    await row.getByRole("button", { name: "Check Acme for new jobs" }).click();
    await expect(page.getByText("Acme: 1 new lead, 0 updated · 1 board incomplete")).toBeVisible();
    await expect(page.getByText(/Workday reports at most 2000 jobs/)).toBeVisible();

    await page.goto("/leads");
    const lead = page.getByTestId("lead-row").filter({ hasText: "Firmware Engineer" });
    await expect(lead).toContainText("Workday");
    await expect(lead).toContainText("Listed");
  });
});

test("mobile: leads render as cards with their actions", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await watch(page, "Stripe");
  await page.goto("/leads");
  await page.getByRole("button", { name: "Check for new jobs" }).click();
  const cards = page.getByTestId("lead-card");
  await expect(cards).toHaveCount(3);
  await expect(
    cards.first().getByRole("button", { name: /^Create application for / }),
  ).toBeVisible();
});

test("a transport failure during a check keeps the inbox usable", async ({ page }) => {
  await page.goto("/leads");
  await page.route("**/leads", async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  const check = page.getByRole("button", { name: "Check for new jobs" });
  await check.click();
  await expect(
    page.getByText(/The check was interrupted\. Some results may have been saved/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect(check).toBeEnabled();
});
