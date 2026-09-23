import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  chromium,
  test,
  type BrowserContext,
  type Frame,
  type Page,
  type Worker,
} from "@playwright/test";
import {
  chooseInline,
  createApplication,
  createUser,
  deleteUser,
  expect,
  signIn,
  type E2EUser,
} from "./helpers/auth";
import { EXTENSION_ID } from "./helpers/extension";

/** The few extension APIs the test drives from the service worker. */
interface WorkerGlobal {
  chrome: {
    storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
    tabs: { query(q: { url: string }): Promise<unknown[]> };
  };
  jwordStartCapture(tab: unknown): Promise<void>;
}

const BASE = "http://localhost:3100";
// A different site from jword (localhost), like a real job board. The extension may script it
// because 127.0.0.1 is in its host permissions; a real capture uses the toolbar click instead.
const JOB_PAGE = "http://127.0.0.1:3100/__fixture/job";
const EXTENSION = path.resolve("packages/extension/dist");

/**
 * Loads the real built extension into Chromium and drives the whole path: extractor on a job
 * page -> in-page overlay (extension frame) -> background worker -> /api/extension/* with the
 * owner's cookie -> shared services. Headless Chromium cannot click the toolbar button, so the
 * test calls the same function the click handler does.
 */
test.describe("browser extension overlay", () => {
  let context: BrowserContext;
  let worker: Worker;
  let user: E2EUser;

  test.beforeAll(() => {
    execSync("pnpm ext:build", { stdio: "ignore" });
  });

  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "desktop-chromium", "extensions need desktop Chromium");
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      baseURL: BASE,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    user = await createUser();
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // The manifest key pins the id the server allows (JWORD_EXTENSION_ID).
    expect(new URL(worker.url()).host).toBe(EXTENSION_ID);
    await worker.evaluate(
      (url) => (globalThis as unknown as WorkerGlobal).chrome.storage.sync.set({ jwordUrl: url }),
      BASE,
    );
    // A job page carrying schema.org JSON-LD (Acme, "Security Engineer, Cloud").
    const html = readFileSync("packages/extension/test/fixtures/ashby.html", "utf8");
    await context.route(JOB_PAGE, (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
  });

  test.afterEach(async () => {
    await context?.close();
    if (user) await deleteUser(user.id);
  });

  /** Open the job page and do what a toolbar click does; returns the page and overlay frame. */
  async function capture(): Promise<{ job: Page; overlay: Frame }> {
    const job = await context.newPage();
    await job.goto(JOB_PAGE);
    await worker.evaluate(async (jobUrl) => {
      const g = globalThis as unknown as WorkerGlobal;
      const [tab] = await g.chrome.tabs.query({ url: jobUrl });
      await g.jwordStartCapture(tab);
    }, JOB_PAGE);
    let overlay: Frame | undefined;
    await expect
      .poll(() => (overlay = job.frames().find((f) => f.url().includes("/overlay.html"))))
      .toBeTruthy();
    return { job, overlay: overlay! };
  }

  const fact = (page: Page, term: string) =>
    page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");

  test("reviews the posting in an overlay beside the page and adds it", async () => {
    await signIn(await context.newPage(), user.email);
    const { job, overlay } = await capture();

    await expect(overlay.getByLabel("Company *")).toHaveValue("Acme");
    await expect(overlay.getByLabel("Role *")).toHaveValue("Security Engineer, Cloud");
    await expect(overlay.getByLabel("Location")).toHaveValue("New York City, NY, USA");
    await expect(overlay.getByLabel("Description")).toHaveValue(/Harden cloud accounts/);
    await expect(overlay.getByLabel("Status")).toHaveText("Applied");
    await expect(overlay.getByText("No matching applications found.")).toBeVisible();

    // The panel pushes the page over, and the page cannot reach into it.
    expect(await job.evaluate(() => document.documentElement.style.width)).toBe(
      "calc(100% - 420px)",
    );
    expect(
      await job.evaluate(() => ({
        shadow: document.querySelector("jword-capture-overlay")?.shadowRoot ?? null,
        frames: document.querySelectorAll("iframe").length,
      })),
    ).toEqual({ shadow: null, frames: 0 });

    await overlay.getByRole("button", { name: "Add application" }).click();
    await expect(overlay.getByText("Saved to jword")).toBeVisible();
    const href = await overlay.getByRole("link", { name: "Open application" }).getAttribute("href");
    expect(href).toMatch(new RegExp(`^${BASE}/applications/[0-9a-f-]{36}$`));

    const detail = await context.newPage();
    await detail.goto(href!);
    await expect(detail.getByRole("heading", { name: "Security Engineer, Cloud" })).toBeVisible();
    await expect(fact(detail, "Location")).toHaveText("New York City, NY, USA");
    await expect(detail.getByTestId("activity").filter({ hasText: "Created" })).toHaveCount(1);
  });

  test("updates a matching application with only the selected fields, through a stale version", async () => {
    const owner = await context.newPage();
    await signIn(owner, user.email);
    const detailUrl = await createApplication(owner, {
      company: "Acme",
      title: "Security Engineer, Cloud",
      location: "Boston, MA",
    });
    const { overlay } = await capture();

    // The match is offered, never chosen for the owner.
    const match = overlay.getByRole("radio", { name: /Update Acme — Security Engineer, Cloud/ });
    await expect(match).toBeVisible();
    await expect(match).not.toBeChecked();
    await expect(overlay.getByRole("button", { name: "Add application" })).toBeDisabled();

    await match.check();
    const plan = overlay.getByTestId("capture-plan");
    await expect(plan.getByRole("checkbox", { name: /Description/ })).toBeChecked();
    await expect(plan.getByRole("checkbox", { name: /Location/ })).not.toBeChecked();
    await expect(plan.getByText("Current: Boston, MA")).toBeVisible();
    // A field the posting lacks is shown as kept: a capture never clears a value.
    await overlay.getByLabel("Location", { exact: true }).fill("");
    await expect(overlay.getByTestId("capture-kept")).toHaveText(
      /Location: keeping Boston, MA \(not in posting\)/,
    );

    // The owner changes the application in jword meanwhile: the save must not overwrite blindly.
    await owner.goto(detailUrl);
    await chooseInline(owner, "Status for Acme Security Engineer, Cloud", "Interview");
    await expect(
      owner.getByRole("combobox", { name: /^Status for Acme Security Engineer, Cloud: Interview/ }),
    ).toBeVisible();

    await overlay.getByRole("button", { name: "Update application" }).click();
    await expect(overlay.getByText("This application changed since you opened it.")).toBeVisible();
    await expect(plan.getByRole("checkbox", { name: /Description/ })).toBeChecked();
    await overlay.getByRole("button", { name: "Update application" }).click();
    await expect(overlay.getByText("Saved to jword")).toBeVisible();

    await owner.goto(detailUrl);
    await expect(fact(owner, "Location")).toHaveText("Boston, MA");
    await owner.getByText("Job description").click();
    await expect(owner.getByText(/Harden cloud accounts/)).toBeVisible();
    await expect(
      owner.getByTestId("activity").filter({ hasText: "Details updated" }).first(),
    ).toBeVisible();
    await owner.goto("/?q=acme");
    await expect(owner.getByTestId("application-row")).toHaveCount(1);
  });

  test("a signed-out overlay keeps the posting until the owner signs in", async () => {
    const { overlay } = await capture();
    await expect(overlay.getByText("Signed out of jword")).toBeVisible();
    await expect(overlay.getByRole("link", { name: "Sign in to jword" })).toHaveAttribute(
      "href",
      `${BASE}/sign-in`,
    );

    // Signing in in a normal tab; the background worker then sends that session.
    await signIn(await context.newPage(), user.email);
    await overlay.getByRole("button", { name: "Try again" }).click();
    await expect(overlay.getByText("No matching applications found.")).toBeVisible();
    await expect(overlay.getByLabel("Company *")).toHaveValue("Acme");
  });

  test("closing the overlay restores the page", async () => {
    const { job, overlay } = await capture();
    await overlay.getByRole("button", { name: "Close jword capture" }).click();
    await expect.poll(() => job.locator("jword-capture-overlay").count()).toBe(0);
    expect(await job.evaluate(() => document.documentElement.style.width)).toBe("");
  });

  test("the background worker answers only the overlay holding the capture's nonce", async () => {
    await signIn(await context.newPage(), user.email);
    await capture();
    const stray = await context.newPage();
    await stray.goto(`chrome-extension://${EXTENSION_ID}/overlay.html#not-the-nonce`);
    await expect(stray.getByText("This capture is out of date.")).toBeVisible();
  });
});
