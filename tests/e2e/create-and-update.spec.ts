import { chooseInline, expect, formatDate, test, todayInChicago } from "./helpers/auth";

test("create an application, update it inline, then search and filter", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.startsWith("mobile");
  const row = () => page.getByTestId(isMobile ? "application-card" : "application-row");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();

  await page.goto("/applications/new");
  await page.getByLabel("Company *").fill("Datadog");
  await page.getByLabel("Role *").fill("Backend Engineer");
  await page.getByLabel("Status").click();
  await page.getByRole("option", { name: "Applied", exact: true }).click();
  await expect(page.getByText("defaults to today")).toBeVisible();
  await page.getByRole("button", { name: "Add application" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);

  // Applied date defaulted to today in Central time, not blank.
  const appliedTerm = page.locator("dt", { hasText: "Date applied" });
  await expect(appliedTerm.locator("xpath=following-sibling::dd")).toHaveText(
    formatDate(todayInChicago()),
  );

  // Inline status update from the detail header.
  await chooseInline(page, "Status for Datadog Backend Engineer", "Interview");
  await expect(page.getByText("Status changed from APPLIED to INTERVIEW").first()).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: /^Status for Datadog Backend Engineer: Interview/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId("activity").filter({ hasText: "Status changed" }).first(),
  ).toBeVisible();

  await chooseInline(page, "Priority for Datadog Backend Engineer", "High");
  await expect(
    page.getByRole("combobox", { name: /^Priority for Datadog Backend Engineer: High/ }),
  ).toBeVisible();

  // Table reflects the database state.
  await page.goto("/");
  await expect(row()).toHaveCount(1);
  await expect(row().first()).toContainText("Datadog");
  await expect(row().first()).toContainText("Backend Engineer");
  await expect(row().first()).toContainText("Interview");
  await expect(row().first()).toContainText("High");

  // Search.
  const search = page.getByLabel("Search by company or role");
  await search.fill("data");
  await expect(page).toHaveURL(/q=data/);
  await expect(row()).toHaveCount(1);
  await search.fill("zzz");
  await expect(page.getByRole("heading", { name: "No matching applications" })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(row()).toHaveCount(1);

  // Status filter.
  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Offer", exact: true }).click();
  await expect(page).toHaveURL(/status=OFFER/);
  await expect(page.getByRole("heading", { name: "No matching applications" })).toBeVisible();
  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Interview", exact: true }).click();
  await expect(row()).toHaveCount(1);
});
