import type { Page } from "@playwright/test";
import { createApplication, expect, test } from "./helpers/auth";

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

  test("add from a pasted URL, edit, stale edit, deactivate, duplicate, reactivate", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Watchlist" }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
    await expect(page.getByRole("heading", { name: "Watchlist", exact: true })).toBeVisible();
    await expect(page.getByText("No watched companies yet")).toBeVisible();

    // Add: the pasted job URL pre-fills provider and board identifier, editable before saving.
    let dialog = await openAdd(page);
    await dialog
      .getByLabel("Board or careers URL")
      .fill("https://job-boards.greenhouse.io/stripe/jobs/6523462?gh_jid=6523462");
    await expect(dialog.getByText("Detected Greenhouse board “stripe”")).toBeVisible();
    await expect(dialog.getByLabel("Board identifier *")).toHaveValue("stripe");
    await expect(
      dialog.getByText("Board URL: https://job-boards.greenhouse.io/stripe"),
    ).toBeVisible();
    await dialog.getByLabel("Company *").fill("Stripe");
    await choose(page, "Interest", "4");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByTestId("watch-row").filter({ hasText: "Stripe" });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Greenhouse", { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: "Open Stripe job board" })).toHaveAttribute(
      "href",
      "https://job-boards.greenhouse.io/stripe",
    );
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByText("4/5")).toBeVisible();
    await expect(row.getByText(/Started watching Stripe \(Greenhouse\) · You/)).toBeVisible();

    // Edit the reused company fields.
    await row.getByRole("button", { name: "Edit Stripe" }).click();
    dialog = page.getByRole("dialog", { name: "Edit Stripe" });
    await choose(page, "Interest", "5 (high)");
    await dialog.getByLabel("Company notes").fill("Payments infra team");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText("5/5")).toBeVisible();
    await expect(row.getByText(/Updated watch for Stripe/)).toBeVisible();

    // Stale edit: tab B opens the editor, tab A deactivates, tab B's save is rejected and
    // keeps the draft until it is explicitly reapplied onto the latest values.
    const tabB = await page.context().newPage();
    await tabB.goto("/watchlist");
    await tabB.getByRole("button", { name: "Edit Stripe" }).click();
    const dialogB = tabB.getByRole("dialog", { name: "Edit Stripe" });
    await dialogB.getByLabel("Website").fill("https://stripe.com");

    await row.getByRole("button", { name: "Deactivate Stripe" }).click();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(row.getByText(/Stopped watching Stripe/)).toBeVisible();

    await dialogB.getByRole("button", { name: "Save changes" }).click();
    await expect(dialogB.getByText("This watch changed since you opened it.")).toBeVisible();
    await expect(dialogB.getByLabel("Website")).toHaveValue("https://stripe.com");
    await dialogB.getByRole("button", { name: "Refresh latest values" }).click();
    await dialogB.getByRole("button", { name: "Reapply my edits" }).click();
    await dialogB.getByRole("button", { name: "Save changes" }).click();
    await expect(dialogB).toBeHidden();
    const rowB = tabB.getByTestId("watch-row").filter({ hasText: "Stripe" });
    await expect(rowB.getByText("Inactive", { exact: true })).toBeVisible();
    await tabB.close();

    // Duplicate: a second add for the same company (any spelling) offers reactivation.
    // No reload first: the Add dialog must reopen after an earlier save in the same page.
    dialog = await openAdd(page);
    await dialog.getByLabel("Company *").fill("  stripe ");
    await dialog.getByLabel("Board identifier *").fill("stripe");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    const already = dialog.getByRole("alert").filter({ hasText: "Already on your watchlist" });
    await expect(already).toContainText("Stripe is already on your watchlist (inactive).");
    await already.getByRole("button", { name: "Reactivate it" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("watch-row")).toHaveCount(1);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByText(/Resumed watching Stripe/)).toBeVisible();

    // Filters: inactive shows nothing now; provider filter keeps the row.
    await page.goto("/watchlist?state=inactive");
    await expect(page.getByText("No matching companies")).toBeVisible();
    await page.goto("/watchlist?provider=GREENHOUSE");
    await expect(page.getByTestId("watch-row")).toHaveCount(1);
  });

  test("watching an existing company reuses it and links to its applications", async ({ page }) => {
    await createApplication(page, { company: "Datadog", title: "Backend Engineer" });
    await page.goto("/watchlist");
    const dialog = await openAdd(page);
    await dialog.getByLabel("Board or careers URL").fill("https://careers.datadoghq.com/");
    await expect(dialog.getByText(/set as Other with this careers page/)).toBeVisible();
    await expect(dialog.getByLabel("Careers page URL")).toHaveValue(
      "https://careers.datadoghq.com/",
    );
    await dialog.getByLabel("Company *").fill("Data");
    await dialog
      .getByRole("list", { name: "Existing companies" })
      .getByRole("button", { name: "Datadog" })
      .click();
    await expect(dialog.getByText("(existing company)")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByTestId("watch-row").filter({ hasText: "Datadog" });
    await expect(row.getByText("Other", { exact: true })).toBeVisible();
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
  await dialog.getByLabel("Board or careers URL").fill("jobs.lever.co/netflix/abc-123");
  await expect(dialog.getByLabel("Board identifier *")).toHaveValue("netflix");
  await dialog.getByLabel("Company *").fill("Netflix");
  await dialog.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByTestId("watch-card").filter({ hasText: "Netflix" });
  await expect(card.getByText("Lever", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Deactivate Netflix" }).click();
  await expect(card.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Reactivate Netflix" })).toBeVisible();
});
