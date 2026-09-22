import { chooseInline, createApplication, expect, test } from "./helpers/auth";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop only");

test("duplicate creation warns and stale edits are rejected", async ({ page }) => {
  const firstUrl = await createApplication(page, { company: "IBM", title: "Software Engineer" });

  // Same company + title again → warning, nothing created.
  await page.goto("/applications/new");
  await page.getByLabel("Company *").fill("ibm");
  await page.getByLabel("Role *").fill("software  engineer");
  await page.getByRole("button", { name: "Add application" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Possible duplicate" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("link", { name: /IBM — Software Engineer/ })).toBeVisible();
  await expect(page).toHaveURL(/\/applications\/new$/);

  const other = await page.context().newPage();
  await other.goto("/");
  await expect(other.getByTestId("application-row")).toHaveCount(1);
  await other.close();

  // Deliberate separate application.
  await page.getByRole("button", { name: "Create anyway as a separate application" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  await page.goto("/");
  await expect(page.getByTestId("application-row")).toHaveCount(2);

  // Stale version: two tabs on the same application.
  const tabA = page;
  const tabB = await page.context().newPage();
  await tabA.goto(firstUrl);
  await tabB.goto(firstUrl);

  await chooseInline(tabA, "Status for IBM Software Engineer", "Applied");
  await expect(
    tabA.getByRole("combobox", { name: /^Status for IBM Software Engineer: Applied/ }),
  ).toBeVisible();

  await chooseInline(tabB, "Status for IBM Software Engineer", "Interview");
  await expect(tabB.getByText("changed since you opened it")).toBeVisible();
  await expect(
    tabB.getByRole("combobox", { name: /^Status for IBM Software Engineer: Applied/ }),
  ).toBeVisible();
  await expect(tabB.getByTestId("activity").filter({ hasText: "Status changed" })).toHaveCount(1);
  await tabB.close();
});
