import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApplication, expect, test } from "./helpers/auth";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop only");

test("CSV import: template file previews and commits", async ({ page }) => {
  // Wait for hydration before uploading: the file input's change event must reach React.
  await page.goto("/import", { waitUntil: "networkidle" });
  await page.locator("#csv-file").setInputFiles(resolve("public/jword-import-template.csv"));
  await expect(page.locator("#map-company")).toContainText("Company");
  await expect(page.locator("#map-title")).toContainText("Role");
  await page.getByRole("button", { name: "Validate rows" }).click();
  await expect(page.getByTestId("import-row")).toHaveCount(2);
  await expect(page.getByTestId("import-row").filter({ hasText: "OK" })).toHaveCount(2);
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Imported 2 application(s)")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("application-row")).toHaveCount(2);
  await expect(page.getByTestId("application-row").filter({ hasText: "Datadog" })).toHaveCount(1);
  await expect(page.getByTestId("application-row").filter({ hasText: "IBM" })).toHaveCount(1);
});

test("CSV import: errors block rows, duplicates need an explicit choice", async ({ page }) => {
  await createApplication(page, { company: "Ramp", title: "Backend Engineer" });

  const csv = [
    "Company,Role,Status,Date applied,Notes",
    "Stripe,Platform Engineer,APPLIED,9/1/2026,Met recruiter at a meetup",
    "Plaid,Data Engineer,Maybe,,",
    "Ramp,Backend Engineer,SAVED,,",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "jword-e2e-"));
  const file = join(dir, "sheet.csv");
  writeFileSync(file, csv, "utf8");

  await page.goto("/import", { waitUntil: "networkidle" });
  await page.locator("#csv-file").setInputFiles(file);
  await expect(page.locator("#map-company")).toContainText("Company");
  await expect(page.locator("#map-title")).toContainText("Role");
  await page.getByRole("button", { name: "Validate rows" }).click();

  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(3);
  const errorRow = rows.filter({ hasText: "Plaid" });
  await expect(errorRow).toHaveAttribute("data-state", "error");
  await expect(errorRow).toContainText('Unknown status "Maybe"');
  await expect(errorRow.getByLabel("Include row 2")).toBeDisabled();

  const flagged = rows.filter({ hasText: "Ramp" });
  await expect(flagged).toHaveAttribute("data-state", "flagged");
  await expect(flagged).toContainText("Looks like existing");
  await expect(flagged.getByLabel("Include row 3")).not.toBeChecked();

  await expect(page.getByRole("button", { name: "Import 1 row" })).toBeEnabled();
  await flagged.getByLabel("Import row 3 as a separate application").check();
  await expect(flagged.getByLabel("Include row 3")).toBeChecked();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Imported 2 application(s)")).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("application-row")).toHaveCount(3);
  await expect(page.getByTestId("application-row").filter({ hasText: "Stripe" })).toHaveCount(1);
  await expect(page.getByTestId("application-row").filter({ hasText: "Ramp" })).toHaveCount(2);
  await expect(page.getByTestId("application-row").filter({ hasText: "Plaid" })).toHaveCount(0);
});
