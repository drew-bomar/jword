import { randomUUID } from "node:crypto";
import { request as playwrightRequest } from "@playwright/test";
import { createApplication, expect, test } from "./helpers/auth";
import { EXTENSION_ORIGIN } from "./helpers/extension";

/**
 * The capture API's boundary (decision 017). A Playwright request context is not a browser, so
 * it can set `Origin` freely; here it stands in for the extension's background worker, and for
 * the forged requests a real browser would never let a website send.
 */
const json = (origin: string | null, data: unknown) => ({
  headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
  data: JSON.stringify(data),
});

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API checks do not depend on the viewport");
});

test("refuses calls that do not come from the jword extension, even with the owner's cookie", async ({
  page,
}) => {
  const body = { company: "Acme", title: "Engineer" };
  for (const origin of [null, "https://evil.example", "http://localhost:3100"]) {
    const response = await page.request.post("/api/extension/find-duplicates", json(origin, body));
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  }
  // A real website's fetch carries its own origin; here even jword's own pages are refused.
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/extension/find-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Acme", title: "Engineer" }),
    });
    return response.status;
  });
  expect(status).toBe(403);
});

test("answers a signed-out extension call with 401 JSON, not a sign-in redirect", async ({
  baseURL,
}) => {
  const anonymous = await playwrightRequest.newContext({ baseURL });
  const response = await anonymous.post(
    "/api/extension/search-applications",
    json(EXTENSION_ORIGIN, { text: "acme" }),
  );
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  await anonymous.dispose();
});

test("updates only posting fields, with version checks and identical-retry replay", async ({
  page,
}) => {
  const detailUrl = await createApplication(page, { company: "Globex", title: "SRE" });
  const applicationId = detailUrl.split("/").pop()!;
  const post = (path: string, data: unknown) =>
    page.request.post(`/api/extension/${path}`, json(EXTENSION_ORIGIN, data));

  const current = await (await post("get-application", { applicationId })).json();
  expect(current).toMatchObject({ ok: true, data: { company: "Globex", version: 1 } });

  // A capture may never change status, company, title, or priority.
  const sneaky = await post("update-posting", {
    requestId: randomUUID(),
    applicationId,
    expectedVersion: 1,
    location: "Remote",
    status: "OFFER",
  });
  expect(sneaky.status()).toBe(400);
  expect((await sneaky.json()).error.code).toBe("VALIDATION_ERROR");

  const command = {
    requestId: randomUUID(),
    applicationId,
    expectedVersion: 1,
    location: "Remote",
  };
  const first = await (await post("update-posting", command)).json();
  expect(first).toMatchObject({ ok: true, data: { version: 2 } });
  const retry = await (await post("update-posting", command)).json();
  expect(retry).toMatchObject({ ok: true, data: { version: 2, replayed: true } });

  const stale = await post("update-posting", { ...command, requestId: randomUUID() });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toMatchObject({ code: "CONFLICT", reason: "STALE_VERSION" });

  await page.goto(detailUrl);
  await expect(page.getByTestId("activity").filter({ hasText: "Details updated" })).toHaveCount(1);
});
