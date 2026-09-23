import type { Page } from "@playwright/test";
import { chooseInline, createApplication, expect, test } from "./helpers/auth";

/**
 * Stands in for the extension's bridge (packages/extension/src/background.ts): answer the page's
 * ready message with a posting, exactly as the injected content script does. The real extractor
 * is covered by packages/extension/test/extract.test.ts.
 */
async function withExtension(page: Page, posting: Record<string, unknown>) {
  await page.addInitScript(
    (payload) => {
      window.addEventListener("message", (event) => {
        if (event.source === window && event.data?.type === "jword:capture-ready") {
          window.postMessage({ type: "jword:capture-payload", payload }, window.location.origin);
        }
      });
    },
    { version: 1, extractor: "greenhouse", source: "Greenhouse", ...posting },
  );
}

test("captures a new posting as an application", async ({ page }) => {
  await withExtension(page, {
    pageUrl: "https://job-boards.greenhouse.io/globex/jobs/777?gh_src=x",
    jobUrl: "https://job-boards.greenhouse.io/globex/jobs/777",
    company: "Globex",
    title: "Platform Engineer",
    location: "Austin, TX",
    workArrangement: "HYBRID",
    externalJobId: "777",
    datePosted: "2026-09-01",
    description: "Build the platform.\n\n• Own deploys",
  });
  await page.goto("/capture");

  await expect(page.getByLabel("Company *")).toHaveValue("Globex");
  await expect(page.getByLabel("Role *")).toHaveValue("Platform Engineer");
  await expect(page.getByLabel("Description")).toHaveValue(/Own deploys/);
  await expect(page.getByText("No matching applications found.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /New application/ })).toBeChecked();

  await page.getByRole("button", { name: "Add application" }).click();
  await expect(page.getByText("Saved to jword")).toBeVisible();
  await page.getByRole("link", { name: "Open application" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: "Platform Engineer" })).toBeVisible();
  const fact = (term: string) =>
    page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");
  await expect(fact("Location")).toHaveText("Austin, TX");
  await expect(fact("Work arrangement")).toHaveText("Hybrid");
  await expect(fact("Source")).toHaveText("Greenhouse");
  await expect(fact("External job ID")).toHaveText("777");
  await page.getByText("Job description").click();
  await expect(page.getByText("Build the platform.")).toBeVisible();
  await expect(page.getByTestId("activity").filter({ hasText: "Created" }).first()).toBeVisible();
});

test("updates a matching application only with the fields the owner selects", async ({
  page,
  context,
}, testInfo) => {
  const detailUrl = await createApplication(page, {
    company: "Datadog",
    title: "Backend Engineer",
    location: "New York, NY",
  });

  await withExtension(page, {
    pageUrl: "https://jobs.lever.co/datadog/abc",
    company: "datadog",
    title: "Backend Engineer",
    location: "Remote - US",
    externalJobId: "abc",
    description: "Scale the metrics pipeline.",
  });
  await page.goto("/capture");

  // The match is offered, never chosen for the owner.
  const match = page.getByRole("radio", { name: /Update Datadog — Backend Engineer/ });
  await expect(match).toBeVisible();
  await expect(page.getByText("same company and role")).toBeVisible();
  await expect(match).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Add application" })).toBeDisabled();

  await match.check();
  const plan = page.getByTestId("capture-plan");
  await expect(plan.getByRole("checkbox", { name: /Description/ })).toBeChecked();
  await expect(plan.getByRole("checkbox", { name: /External job ID/ })).toBeChecked();
  const location = plan.getByRole("checkbox", { name: /Location/ });
  await expect(location).not.toBeChecked();
  await expect(plan.getByText("Current: New York, NY")).toBeVisible();

  // Someone else edits the application meanwhile: the save must not overwrite blindly.
  const other = await context.newPage();
  await other.goto(detailUrl);
  await chooseInline(other, "Status for Datadog Backend Engineer", "Applied");
  await expect(
    other.getByRole("combobox", { name: /^Status for Datadog Backend Engineer: Applied/ }),
  ).toBeVisible();
  await other.close();

  await page.getByRole("button", { name: "Update application" }).click();
  await expect(page.getByText("This application changed since you opened it.")).toBeVisible();
  // The owner's selection survives the refresh; saving again uses the new version.
  await expect(plan.getByRole("checkbox", { name: /Description/ })).toBeChecked();
  await page.getByRole("button", { name: "Update application" }).click();
  await expect(page.getByText("Saved to jword")).toBeVisible();

  await page.goto(detailUrl);
  const fact = (term: string) =>
    page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");
  await expect(fact("Location")).toHaveText("New York, NY");
  await expect(fact("External job ID")).toHaveText("abc");
  await page.getByText("Job description").click();
  await expect(page.getByText("Scale the metrics pipeline.")).toBeVisible();
  await expect(
    page.getByTestId("activity").filter({ hasText: "Details updated" }).first(),
  ).toBeVisible();
  // Still one application: nothing was duplicated.
  await page.goto("/?q=datadog");
  const isMobile = testInfo.project.name.startsWith("mobile");
  await expect(page.getByTestId(isMobile ? "application-card" : "application-row")).toHaveCount(1);
});

test("explains itself when opened without the extension", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByText("No job posting received")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add an application manually" })).toBeVisible();
});
