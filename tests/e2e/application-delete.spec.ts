import { createApplication, expect, test } from "./helpers/auth";

test("Edit details can permanently delete an application after confirming", async ({ page }) => {
  await createApplication(page, {
    company: "Delete Me Inc",
    title: "Test Engineer",
    initialNote: "x",
  });

  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  // The delete step lives in its own labelled section below the edit form.
  const section = dialog.getByRole("region", { name: "Delete application" });
  await section.getByRole("button", { name: "Delete application" }).click();
  await expect(
    dialog.getByText(/Permanently delete Test Engineer at Delete Me Inc\?/),
  ).toBeVisible();

  // Cancel returns to the first step and deletes nothing.
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(section.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await section.getByRole("button", { name: "Delete application" }).click();
  await section.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText("Deleted application for Test Engineer at Delete Me Inc"),
  ).toBeVisible();
  await expect(
    page.getByTestId("application-row").filter({ hasText: "Test Engineer" }),
  ).toHaveCount(0);
});

test("an unconfirmed deletion locks editing and cancellation until the original delete is retried", async ({
  page,
}) => {
  const url = await createApplication(page, { company: "Delete Retry", title: "Engineer" });
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  const section = dialog.getByRole("region", { name: "Delete application" });
  await section.getByRole("button", { name: "Delete application" }).click();
  let dropped = false;
  await page.route(url, async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await section.getByRole("button", { name: "Delete permanently" }).click();
  await expect(section.getByRole("button", { name: "Retry delete" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  for (const cancel of await dialog.getByRole("button", { name: "Cancel", exact: true }).all()) {
    await expect(cancel).toBeDisabled();
  }
  await expect(dialog.getByLabel("Role *")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await section.getByRole("button", { name: "Retry delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Earlier deletion confirmed.")).toBeVisible();
});

test("an unconfirmed edit prevents deletion until the edit retry is resolved", async ({ page }) => {
  const url = await createApplication(page, { company: "Edit Retry", title: "Engineer" });
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  await dialog.getByLabel("Role *").fill("Senior Engineer");
  let dropped = false;
  await page.route(url, async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Retry original save" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete application", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Retry original save" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(
    dialog.getByRole("button", { name: "Delete application", exact: true }),
  ).toBeEnabled();
});
