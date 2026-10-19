import { test as base, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadTestEnv } from "../../test-env";
import { E2E_DISCOVERY_USER_ID } from "./discovery";

loadTestEnv();

function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (run `pnpm db:start`).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface E2EUser {
  id: string;
  email: string;
}

/** By default the user has discovery features (the server's owner id); see ./discovery.ts. */
export async function createUser({ discovery = true } = {}): Promise<E2EUser> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  // A test that crashed before cleanup may have left the fixed-id user behind.
  if (discovery) await admin().auth.admin.deleteUser(E2E_DISCOVERY_USER_ID);
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    ...(discovery ? { id: E2E_DISCOVERY_USER_ID } : {}),
  });
  if (error) throw error;
  return { id: data.user.id, email };
}

export async function deleteUser(id: string): Promise<void> {
  await admin().auth.admin.deleteUser(id);
}

/** The callback path a real magic link would open, optionally continuing to `next`. */
export async function magicLinkPath(email: string, next?: string): Promise<string> {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const tokenHash = encodeURIComponent(data.properties.hashed_token);
  const then = next ? `&next=${encodeURIComponent(next)}` : "";
  return `/auth/callback?token_hash=${tokenHash}&type=magiclink${then}`;
}

/** Signs the page in through the same callback route a real magic link would hit. */
export async function signIn(page: Page, email: string): Promise<void> {
  // Wake the local PostgREST clock before minting a fresh token. v16.2 can reject
  // the first fresh JWT after idle (upstream PostgREST/postgrest#5196).
  // This readiness read does not retry or conceal a failing application request.
  const { error: readinessError } = await admin().from("applications").select("id").limit(1);
  if (readinessError) throw new Error(`Local database readiness: ${readinessError.code}`);
  await page.goto(await magicLinkPath(email));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
}

export function todayInChicago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y!, m! - 1, d!, 12)));
}

/**
 * Fixture: each test gets a fresh user and an authenticated page. `test.use({ discovery: false })`
 * makes that user a public user without watchlist/Leads/preferences (decision 027).
 */
export const test = base.extend<{ discovery: boolean; user: E2EUser; page: Page }>({
  discovery: [true, { option: true }],
  user: async ({ discovery }, use) => {
    const user = await createUser({ discovery });
    await use(user);
    await deleteUser(user.id);
  },
  page: async ({ page, user }, use) => {
    await signIn(page, user.email);
    await use(page);
  },
});

export { expect };

/** Create an application through the UI and return its detail URL. */
export async function createApplication(
  page: Page,
  fields: {
    company: string;
    title: string;
    status?: string;
    initialNote?: string;
    location?: string;
  },
): Promise<string> {
  await page.goto("/applications/new");
  await page.getByLabel("Company *").fill(fields.company);
  await page.getByLabel("Role *").fill(fields.title);
  if (fields.location) await page.getByLabel("Location").fill(fields.location);
  if (fields.status) {
    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: fields.status, exact: true }).click();
  }
  if (fields.initialNote) await page.getByLabel("Initial note").fill(fields.initialNote);
  await page.getByRole("button", { name: "Add application" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  return page.url();
}

/** Change a Radix inline select on the current page by its accessible label prefix. */
export async function chooseInline(
  page: Page,
  labelPrefix: string,
  optionName: string,
): Promise<void> {
  await page
    .getByRole("combobox", { name: new RegExp(`^${labelPrefix}`) })
    .first()
    .click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}
