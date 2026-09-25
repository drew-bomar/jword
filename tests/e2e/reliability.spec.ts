import { createClient } from "@supabase/supabase-js";
import { chooseInline, createApplication, expect, test } from "./helpers/auth";

const admin = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test("Edit details can reopen after a successful save", async ({ page }) => {
  await createApplication(page, { company: "Reopen", title: "Engineer" });
  const edit = page.getByRole("button", { name: "Edit details", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Location").fill("Chicago");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await edit.click();
  await expect(dialog.getByLabel("Location")).toHaveValue("Chicago");
});

test("stale details retain the draft across refresh and preserve another tab's change", async ({
  page,
}) => {
  const url = await createApplication(page, {
    company: "DraftCo",
    title: "Engineer",
    location: "Chicago",
  });
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Location").fill("My unsaved location");
  const other = await page.context().newPage();
  await other.goto(url);
  await other.getByRole("button", { name: "Edit details", exact: true }).click();
  await other.getByRole("dialog").getByLabel("Role *").fill("Senior Engineer");
  await other.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(other.getByRole("heading", { name: "Senior Engineer", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    dialog.getByText("This application changed since you opened it.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Refresh latest values" }).click();
  await expect(dialog.getByLabel("Location")).toHaveValue("My unsaved location");
  await expect(dialog.getByText("Senior Engineer", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reapply my edits" }).click();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Senior Engineer", exact: true })).toBeVisible();
  await expect(page.getByText("My unsaved location", { exact: true })).toBeVisible();
  await other.close();
});

test("create safely replays after the server commits but the browser loses the response", async ({
  page,
  user,
}) => {
  await page.goto("/applications/new", { waitUntil: "networkidle" });
  await page.getByLabel("Company *").fill("LostResponse");
  await page.getByLabel("Role *").fill("Engineer");
  let dropped = false;
  await page.route("**/applications/new", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch(); // commit the real request, then lose only its response
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Add application", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry original save" })).toBeVisible();
  await expect(page.getByLabel("Company *")).toBeDisabled();
  await page.getByRole("button", { name: "Retry original save" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  const { data, error } = await admin()
    .from("application_overview")
    .select("application_id")
    .eq("user_id", user.id);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
});

test("unconfirmed import retains its selection and safely replays deliberate duplicates", async ({
  page,
  user,
}) => {
  await createApplication(page, { company: "RepeatCo", title: "Engineer" });
  await page.goto("/import", { waitUntil: "networkidle" });
  await page.locator("#csv-file").setInputFiles({
    name: "retry.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Company,Role\nRepeatCo,Engineer\n"),
  });
  await page.getByRole("button", { name: "Validate rows" }).click();
  await page.getByLabel("Import row 1 as a separate application").check();
  let dropped = false;
  await page.route("**/import", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Import 1 row", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry safely" })).toBeVisible();
  await expect(page.getByLabel("Include row 1")).toBeDisabled();
  await page.getByRole("button", { name: "Retry safely" }).click();
  await expect(
    page.getByText("This import was already saved earlier; no rows were added twice."),
  ).toBeVisible();
  const { data } = await admin().from("applications").select("id").eq("user_id", user.id);
  expect(data).toHaveLength(2);
});

test("notes retain drafts through conflicts", async ({ page }) => {
  const url = await createApplication(page, {
    company: "NoteCo",
    title: "Engineer",
    initialNote: "Original",
  });
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel("Edit note", { exact: true }).fill("My note draft");
  const other = await page.context().newPage();
  await other.goto(url);
  await chooseInline(other, "Status for NoteCo Engineer", "Applied");
  await expect(
    other.getByRole("combobox", { name: /^Status for NoteCo Engineer: Applied/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByRole("button", { name: "Refresh latest values" }).click();
  await expect(page.getByLabel("Edit note", { exact: true })).toHaveValue("My note draft");
  await page.getByRole("button", { name: "Reapply my note" }).click();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit note", exact: true })).not.toBeVisible();
  await expect(page.getByTestId("note").getByText("My note draft", { exact: true })).toBeVisible();
  await other.close();
});

test("applications, notes and activity remain reachable beyond one page", async ({
  page,
  user,
}) => {
  const client = admin();
  const { error } = await client.rpc("import_applications", {
    p_owner_id: user.id,
    p_actor: "IMPORT",
    p_request_id: crypto.randomUUID(),
    p_command: {
      rows: Array.from({ length: 201 }, (_, i) => ({
        rowIndex: i + 1,
        company: `PageCo ${String(i).padStart(3, "0")}`,
        title: "Engineer",
      })),
    },
  });
  expect(error).toBeNull();
  await page.goto("/?sort=company");
  await page.getByRole("link", { name: "More applications", exact: true }).click();
  await expect(page.getByRole("link", { name: /PageCo 200/ }).first()).toBeVisible();
  await page.getByRole("link", { name: "First applications", exact: true }).click();
  const { data } = await client
    .from("applications")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  for (let i = 0; i < 51; i++) {
    const { error: noteError } = await client.rpc("add_application_note", {
      p_owner_id: user.id,
      p_actor: "USER",
      p_request_id: crypto.randomUUID(),
      p_command: { applicationId: data!.id, expectedVersion: i + 1, note: `Historical note ${i}` },
    });
    expect(noteError).toBeNull();
  }
  await page.goto(`/applications/${data!.id}`);
  await page.getByRole("link", { name: "More notes", exact: true }).click();
  await expect(page.getByText("Historical note 0", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "More activity", exact: true }).click();
  await expect(page.getByText("Imported from CSV", { exact: true })).toBeVisible();
});
