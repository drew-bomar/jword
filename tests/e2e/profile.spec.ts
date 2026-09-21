import { expect, test } from "./helpers/auth";

test("candidate profile can be saved and validates URLs", async ({ page }) => {
  await page.goto("/settings/profile");
  await page.getByLabel("Full name").fill("Drew Tester");
  await page.getByLabel("LinkedIn URL").fill("https://www.linkedin.com/in/drew-tester");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Drew Tester");
  await expect(page.getByLabel("LinkedIn URL")).toHaveValue(
    "https://www.linkedin.com/in/drew-tester",
  );

  await page.getByLabel("GitHub URL").fill("not a url");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "http://" })).toBeVisible();
  await expect(page.getByLabel("GitHub URL")).toHaveAttribute("aria-invalid", "true");
});
