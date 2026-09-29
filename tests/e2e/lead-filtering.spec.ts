import { expect, test } from "./helpers/auth";
import { createClient } from "@supabase/supabase-js";

// Decision 026. Collection answers from E2E_FIXTURE_POSTINGS: Stripe's boards hold a
// Backend Engineer (San Francisco), an Account Executive (New York), and a Solutions
// Architect whose only location is "Remote".

test.describe("search preferences and lead views", () => {
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    "desktop flow; the form is covered on mobile below",
  );

  test("saving preferences re-checks leads and drives the views", async ({ page }) => {
    await page.goto("/watchlist");
    await page.getByRole("button", { name: "Add company" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add to watchlist" });
    await dialog.getByLabel("Company *").fill("Stripe");
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();

    // No preferences yet: every posting is kept.
    await page.goto("/leads");
    await page.getByRole("button", { name: "Check for new jobs" }).click();
    const rows = page.getByTestId("lead-row");
    await expect(rows).toHaveCount(3);

    await page.getByRole("link", { name: "Set search preferences" }).click();
    await expect(page.getByText("No preferences saved yet")).toBeVisible();
    await page.getByLabel("Target level").click();
    await page.getByRole("option", { name: "New graduate / entry level" }).click();
    await page.getByLabel("Employment type").click();
    await page.getByRole("option", { name: "Full-time (no internships)" }).click();
    await page.getByLabel("Add a preferred city").click();
    await page.getByRole("option", { name: "New York City" }).click();
    await page.getByLabel("Add a preferred city").click();
    await page.getByRole("option", { name: "San Francisco" }).click();
    await page.getByRole("button", { name: "Move San Francisco up" }).click();
    await page.getByLabel("Hide remote-only roles in the Recommended view").check();
    await page.getByLabel("Backend", { exact: true }).click();
    await page.getByRole("option", { name: "Preferred" }).click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Preferences saved. Re-checked 3 leads.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("list", { name: "Preferred cities" })).toContainText(
      /1\.San Francisco.*2\.New York City/,
    );

    // Recommended: the Account Executive is filtered out and the remote-only role hidden.
    await page.goto("/leads");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Backend Engineer");
    const labels = rows.first().getByTestId("lead-labels");
    await expect(labels).toContainText("San Francisco");
    await expect(labels).toContainText("Preferred role");

    await page.getByRole("link", { name: "Remote only" }).click();
    await expect(page).toHaveURL(/view=remote/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Solutions Architect");

    await page.getByRole("link", { name: "Filtered out" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Account Executive");
    await expect(rows.first().getByTestId("lead-labels")).toContainText("Not an engineering role");
    // Filtering never dismissed it.
    await expect(rows.first().getByText("New", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "All", exact: true }).click();
    await expect(rows).toHaveCount(3);

    // A further check reports nothing skipped: known postings are refreshed, not filtered.
    await page.getByRole("button", { name: "Check for new jobs" }).click();
    await expect(page.getByTestId("check-summary")).toContainText("0 new leads, 0 updated");
    await expect(page.getByTestId("check-filtered")).toHaveCount(0);
  });

  test("a stale preferences form is refused", async ({ page, context }) => {
    await page.goto("/settings/preferences");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();

    const other = await context.newPage();
    await other.goto("/settings/preferences");
    await other.getByLabel("Hide remote-only roles in the Recommended view").check();
    await other.getByRole("button", { name: "Save preferences" }).click();
    await expect(other.getByText("Preferences saved.")).toBeVisible();

    await page.getByLabel("Hide postings older than (days)").fill("30");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(
      page.getByRole("form", { name: "Search preferences" }).getByRole("alert"),
    ).toContainText("Reload the page");
  });

  test("a lost preference-save response locks the draft until the original save is retried", async ({
    page,
    user,
  }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Hide postings older than (days)").fill("30");
    let dropped = false;
    await page.route("**/settings/preferences", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
    await expect(page.getByLabel("Hide postings older than (days)")).toBeDisabled();
    await expect(page.getByLabel("Target level")).toBeDisabled();
    await page.getByRole("button", { name: "Retry save" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();
    await expect(page.getByLabel("Hide postings older than (days)")).toBeEnabled();
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await admin
      .from("search_preference_activities")
      .select("id")
      .eq("user_id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    await page.reload();
    await expect(page.getByLabel("Hide postings older than (days)")).toHaveValue("30");
  });

  test("an older malformed evaluation cannot crash the Leads page", async ({ page, user }) => {
    await page.goto("/watchlist");
    await page.getByRole("button", { name: "Add company" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add to watchlist" });
    await dialog.getByLabel("Company *").fill("Stripe");
    await expect(dialog.getByText("Selected (2/3)")).toBeVisible();
    await dialog.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(dialog).toBeHidden();
    await page.goto("/leads");
    await page.getByRole("button", { name: "Check for new jobs" }).click();
    await expect(page.getByTestId("lead-row")).toHaveCount(3);
    // A legacy record can predate RPC validation. Service-role writes are test setup only.
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await admin.from("leads").update({ evaluation: {} }).eq("user_id", user.id);
    expect(error).toBeNull();
    await page.reload();
    await expect(page.getByTestId("lead-row")).toHaveCount(3);
    await expect(page.getByTestId("lead-labels")).toHaveCount(0);
  });
});

test("preferences form works on mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/settings/preferences");
  await page.getByLabel("Add a preferred city").click();
  await page.getByRole("option", { name: "Chicago" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Preferred cities" })).toContainText("Chicago");
});
