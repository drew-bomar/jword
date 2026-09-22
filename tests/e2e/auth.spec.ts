import { test as base, expect } from "@playwright/test";

base("signed-out visitors are redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to jword" })).toBeVisible();
});

base("an invalid magic link shows an error on the sign-in page", async ({ page }) => {
  await page.goto("/auth/callback?token_hash=bogus&type=magiclink");
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
});
