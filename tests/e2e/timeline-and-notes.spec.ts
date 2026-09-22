import { createApplication, expect, test } from "./helpers/auth";

test("notes and edits appear in the activity timeline, newest first", async ({ page }) => {
  await createApplication(page, {
    company: "Garmin",
    title: "Embedded Engineer",
    initialNote: "Initial context",
  });

  await expect(page.getByTestId("note")).toHaveCount(1);
  await expect(page.getByTestId("note").first()).toContainText("Initial context");
  await expect(page.getByTestId("activity").filter({ hasText: "Created" })).toHaveCount(1);

  // Add a note.
  await page.getByLabel("Add a note").fill("Finished the OA");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByTestId("note")).toHaveCount(2);
  const added = page.getByTestId("note").filter({ hasText: "Finished the OA" });
  await expect(added.locator("time")).toHaveCount(1);
  await expect(page.getByTestId("activity").filter({ hasText: "Note added" })).toHaveCount(1);

  // Edit that note's text.
  await added.getByRole("button", { name: "Edit note" }).click();
  await added.getByLabel("Edit note").fill("Finished the OA (90 min)");
  await added.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.getByTestId("note").filter({ hasText: "Finished the OA (90 min)" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("activity").filter({ hasText: "Note updated" })).toHaveCount(1);

  // Edit details through the dialog.
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Location").fill("Austin, TX");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  const locationTerm = page.locator("dt", { hasText: "Location" });
  await expect(locationTerm.locator("xpath=following-sibling::dd")).toHaveText("Austin, TX");
  await expect(page.getByTestId("activity").filter({ hasText: "Details updated" })).toHaveCount(1);

  // Newest first.
  const labels = await page.getByTestId("activity").locator("p").first().allTextContents();
  const order = await page
    .getByTestId("activity")
    .evaluateAll((items) => items.map((el) => el.querySelector("p")?.textContent ?? ""));
  expect(labels.length).toBeGreaterThan(0);
  expect(order[0]).toContain("Details updated");
  expect(order[1]).toContain("Note updated");
  expect(order[2]).toContain("Note added");
  expect(order[order.length - 1]).toContain("Created");
  const times = await page
    .getByTestId("activity")
    .locator("time")
    .evaluateAll((els) => els.map((el) => new Date(el.getAttribute("datetime") ?? "").getTime()));
  for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]!);
});
