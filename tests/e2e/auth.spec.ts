import { test as base, expect } from "@playwright/test";

base("signed-out visitors are redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to jword" })).toBeVisible();
});

base("the privacy policy is public and linked from sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "jword privacy policy" })).toBeVisible();
});

base("an invalid magic link shows an error on the sign-in page", async ({ page }) => {
  await page.goto("/auth/callback?token_hash=bogus&type=magiclink");
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(page.getByRole("alert").filter({ hasText: "invalid or expired" })).toBeVisible();
});
