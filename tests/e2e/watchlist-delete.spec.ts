import { createApplication, expect, test } from "./helpers/auth";

test("delete confirms the company, supports cancel, preserves applications, and allows re-add", async ({
  page,
}) => {
  const applicationUrl = await createApplication(page, {
    company: "Delete Test",
    title: "Engineer",
    initialNote: "Keep this application note",
  });
  await page.goto("/watchlist");
  async function add() {
    await page.getByRole("button", { name: "Add company" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add to watchlist" });
    await dialog.getByLabel("Company *").fill("Delete Test");
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();
  }
  await add();
  const row = page
    .locator('[data-testid="watch-row"]:visible, [data-testid="watch-card"]:visible')
    .filter({ hasText: "Delete Test" });
  await row.getByRole("button", { name: "Delete Delete Test from watchlist" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete Delete Test from watchlist?",
    exact: true,
  });
  await expect(dialog).toContainText("Applications, company notes, and history are kept");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete Delete Test from watchlist" }).click();
  await dialog.getByRole("button", { name: "Delete from watchlist", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
  await page.goto(applicationUrl);
  await expect(page.getByText("Keep this application note", { exact: true })).toBeVisible();
  await page.goto("/watchlist");
  await add();
  await expect(row).toHaveCount(1);
});

test("a lost deletion response keeps the original retry and prevents dismissing confirmation", async ({
  page,
}) => {
  await page.goto("/watchlist");
  await page.getByRole("button", { name: "Add company" }).first().click();
  const add = page.getByRole("dialog", { name: "Add to watchlist" });
  await add.getByLabel("Company *").fill("Delete Retry");
  await add.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(add).toBeHidden();
  await page.getByRole("button", { name: "Delete Delete Retry from watchlist" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete Delete Retry from watchlist?",
    exact: true,
  });
  let dropped = false;
  await page.route("**/watchlist", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Delete from watchlist", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry deletion" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Retry deletion" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Delete Delete Retry from watchlist" }),
  ).toHaveCount(0);
});
