import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { createApplication, expect, test } from "./helpers/auth";
import { EXTENSION_ORIGIN } from "./helpers/extension";

/**
 * Public sign-up with owner-only discovery (decision 027). The default fixture user is the
 * discovery user (the server's JWORD_OWNER_USER_ID); `discovery: false` is anyone else.
 */

const MAILPIT = "http://127.0.0.1:54324";
const DISCOVERY_PAGES = ["/watchlist", "/leads", "/settings/preferences"];
const DISCOVERY_ENDPOINTS = ["add-watch", "verify-boards", "search-companies"];

const json = (data: unknown) => ({
  headers: { "Content-Type": "application/json", Origin: EXTENSION_ORIGIN },
  data: JSON.stringify(data),
});

function admin() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** The 6-digit code from the newest Mailpit message sent to `email`. */
async function codeFor(page: Page, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const search = await page.request.get(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      );
      const id = (await search.json()).messages?.[0]?.ID as string | undefined;
      if (!id) return undefined;
      const message = await (await page.request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
      code = /\b(\d{6})\b/.exec(message.Text ?? message.HTML ?? "")?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

async function navLabels(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Primary" }).getByRole("link").allTextContents();
}

test.describe("a public user", () => {
  test.use({ discovery: false });

  test("sees only Applications, Import, and Profile; discovery pages are not found", async ({
    page,
  }) => {
    expect(await navLabels(page)).toEqual(["Applications", "Import", "Profile", "Extension"]);
    for (const path of DISCOVERY_PAGES) {
      // A soft 404: the root loading.tsx streams first, so the status stays 200 and Next adds
      // noindex. What matters is that the not-found page renders instead of discovery data.
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Not found" }), path).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    }
    // The public tracker works.
    await createApplication(page, { company: "Initech", title: "Engineer" });
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import from CSV" })).toBeVisible();
    await page.goto("/settings/profile");
    await expect(page).toHaveURL(/\/settings\/profile$/);
  });

  test("gets 404 from discovery extension and watchlist endpoints but can capture", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "API checks do not depend on viewport");
    for (const endpoint of DISCOVERY_ENDPOINTS) {
      const response = await page.request.post(`/api/extension/${endpoint}`, json({}));
      expect(response.status(), endpoint).toBe(404);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND", reason: "FEATURE_UNAVAILABLE" },
      });
    }
    for (const path of ["boards?company=Stripe", "companies?q=a", "suggestions"]) {
      const response = await page.request.get(`/api/watchlist/${path}`);
      expect(response.status(), path).toBe(404);
    }
    const created = await page.request.post(
      "/api/extension/create-application",
      json({ requestId: randomUUID(), company: "Hooli", title: "Platform Engineer" }),
    );
    expect(created.status()).toBe(200);
    const found = await page.request.post(
      "/api/extension/search-applications",
      json({ text: "Hooli" }),
    );
    expect((await found.json()).data.items).toHaveLength(1);
  });

  test("the extension session says who is signed in, without discovery", async ({
    page,
    user,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "API checks do not depend on viewport");
    const response = await page.request.post("/api/extension/session", json({}));
    expect(await response.json()).toEqual({
      ok: true,
      data: { email: user.email, discovery: false },
    });
  });

  test("can download the extension from the install page", async ({ page }) => {
    await page.goto("/extension");
    await expect(page.getByRole("heading", { name: "Chrome extension" })).toBeVisible();
    const download = await page.request.get("/downloads/jword-capture.zip");
    expect(download.status()).toBe(200);
    // A zip file starts with "PK".
    expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  });
});

test("the discovery user's extension session offers discovery", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API checks do not depend on viewport");
  const response = await page.request.post("/api/extension/session", json({}));
  expect((await response.json()).data.discovery).toBe(true);
});

test("the discovery user still sees Watchlist and Leads", async ({ page }) => {
  expect(await navLabels(page)).toEqual([
    "Applications",
    "Watchlist",
    "Leads",
    "Import",
    "Profile",
    "Extension",
  ]);
  for (const path of DISCOVERY_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Not found" }), path).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  }
});

test("a new email signs up with the emailed code and lands on an empty tracker", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "one sign-up is enough");
  const email = `signup-${Date.now()}-${randomUUID().slice(0, 6)}@test.local`;
  const page = await browser.newPage();
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(`We sent a code to ${email}`)).toBeVisible();
    await page.getByLabel("One-time code").fill(await codeFor(page, email));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("No applications yet")).toBeVisible();
    expect(await navLabels(page)).toEqual(["Applications", "Import", "Profile", "Extension"]);
  } finally {
    await page.close();
    const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
    const user = data.users.find((u) => u.email === email);
    if (user) await admin().auth.admin.deleteUser(user.id);
  }
});
