import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createUser, deleteUser, expect, signIn, type E2EUser } from "./helpers/auth";

/** The few extension APIs the test drives from the service worker. */
interface ChromeApi {
  storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
  tabs: { query(q: { url: string }): Promise<Array<{ id?: number; windowId: number }>> };
}
type WorkerGlobal = { chrome: ChromeApi; jwordStartCapture(tab: unknown): Promise<void> };

const BASE = "http://localhost:3100";
const JOB_PAGE = `${BASE}/__fixture/job`;
const EXTENSION = path.resolve("packages/extension/dist");

/**
 * Loads the real built extension into Chromium and drives the whole handoff: extractor bundle on
 * a job page -> side panel page framing /capture -> postMessage handoff -> preview -> save.
 *
 * Headless Chromium cannot open the real side panel without a user gesture, so the test opens the
 * same extension page (panel.html) in a tab. It frames jword exactly as the side panel does, which
 * is what matters here: the jword session cookie must work inside an extension page's iframe.
 */
test.describe("browser extension", () => {
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
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    user = await createUser();
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await worker.evaluate(
      (url) => (globalThis as unknown as WorkerGlobal).chrome.storage.sync.set({ jwordUrl: url }),
      BASE,
    );
    // A job page on a host the extension may read (localhost), carrying schema.org JSON-LD.
    const html = readFileSync("packages/extension/test/fixtures/ashby.html", "utf8");
    await context.route(JOB_PAGE, (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
  });

  test.afterEach(async () => {
    await context?.close();
    if (user) await deleteUser(user.id);
  });

  /** Open the side-panel page, then do what a toolbar click on the job tab does. */
  async function captureIntoPanel(): Promise<Page> {
    const extensionId = new URL(worker.url()).host;
    const panelUrl = `chrome-extension://${extensionId}/panel.html`;
    const panel = await context.newPage();
    await panel.goto(panelUrl);
    // The panel page is an extension page, so it can report its own browser window.
    const windowId = await panel.evaluate(async () => {
      const c = (
        globalThis as unknown as { chrome: { windows: { getCurrent(): Promise<{ id: number }> } } }
      ).chrome;
      return (await c.windows.getCurrent()).id;
    });
    const job = await context.newPage();
    await job.goto(JOB_PAGE);
    await worker.evaluate(
      async ({ jobUrl, windowId }) => {
        const g = globalThis as unknown as WorkerGlobal;
        const [jobTab] = await g.chrome.tabs.query({ url: jobUrl });
        // Captures are per browser window; target the window showing the panel page.
        await g.jwordStartCapture({ ...jobTab, windowId });
      },
      { jobUrl: JOB_PAGE, windowId },
    );
    return panel;
  }

  test("hands a posting to the capture page framed in the side panel", async () => {
    await signIn(await context.newPage(), user.email);
    const panel = await captureIntoPanel();
    const frame = panel.frameLocator("iframe");

    await expect(frame.getByLabel("Company *")).toHaveValue("Acme");
    await expect(frame.getByLabel("Role *")).toHaveValue("Security Engineer, Cloud");
    await expect(frame.getByLabel("Location")).toHaveValue("New York City, NY, USA");
    await expect(frame.getByLabel("Description")).toHaveValue(/Harden cloud accounts/);
    await expect(frame.getByLabel("Source")).toHaveValue("localhost");
    await expect(frame.getByLabel("Status")).toHaveText("Applied");
    await expect(frame.getByText("No matching applications found.")).toBeVisible();

    await frame.getByRole("button", { name: "Add application" }).click();
    await expect(frame.getByText("Saved to jword")).toBeVisible();
  });

  test("a signed-out panel keeps the posting until the owner signs in", async () => {
    const panel = await captureIntoPanel();
    const frame = panel.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "Sign in to jword" })).toBeVisible();
    await expect(frame.getByRole("link", { name: "Sign in in a new tab" })).toBeVisible();

    // Signing in in a normal tab; the panel frame then uses that session.
    await signIn(await context.newPage(), user.email);
    await frame.getByRole("button", { name: "I've signed in" }).click();
    await expect(frame.getByLabel("Company *")).toHaveValue("Acme");
  });
});
