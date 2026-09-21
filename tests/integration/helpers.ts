import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  createTrackerServices,
  fixedClock,
  JwordError,
  SupabaseTrackerRepository,
  type ActorContext,
  type Database,
  type TrackerServices,
} from "@jword/core";

export const TODAY = "2026-09-21";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const dbUrl = process.env.SUPABASE_DB_URL!;

export type Client = SupabaseClient<Database>;

export function adminClient(): Client {
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): Client {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  /** Client authenticated as this user; RLS applies (the web path). */
  client: Client;
  services: TrackerServices;
  actor: ActorContext;
}

const admin = adminClient();
const created: string[] = [];

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);

  // Password logins are disabled in supabase/config.toml (owner signs in by email link/code),
  // so mint a magic link with the admin API and verify it like the browser callback does.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link.properties?.hashed_token)
    throw new Error(`generateLink failed: ${linkError?.message}`);
  const client = anonClient();
  const signIn = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (signIn.error || !signIn.data.session)
    throw new Error(`signIn failed: ${signIn.error?.message}`);

  const actor: ActorContext = { userId: data.user.id, actorType: "USER" };
  return { id: data.user.id, email, client, actor, services: servicesFor(client) };
}

export function servicesFor(client: Client): TrackerServices {
  return createTrackerServices({
    repository: new SupabaseTrackerRepository(client),
    clock: fixedClock(TODAY),
  });
}

/** Service-role services locked to an explicit owner (the MCP path). */
export function mcpServicesFor(ownerId: string): {
  services: TrackerServices;
  actor: ActorContext;
} {
  return { services: servicesFor(admin), actor: { userId: ownerId, actorType: "CODEX" } };
}

export async function cleanupUsers(): Promise<void> {
  while (created.length) {
    const id = created.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
}

let pool: pg.Pool | null = null;
export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  pool ??= new pg.Pool({ connectionString: dbUrl, max: 2 });
  return pool.query<T>(sql, params);
}

export async function closePg(): Promise<void> {
  await pool?.end();
  pool = null;
}

export const rid = () => randomUUID();

export async function expectJwordError(
  promise: Promise<unknown>,
  code: string,
  reason?: string,
): Promise<JwordError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof JwordError))
      throw new Error(`expected JwordError, got ${String(error)}`);
    if (error.code !== code)
      throw new Error(`expected ${code}, got ${error.code}: ${error.message}`);
    if (reason && error.details.reason !== reason) {
      throw new Error(`expected reason ${reason}, got ${error.details.reason}`);
    }
    return error;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

/** Row-level readers through the admin client (bypass RLS; test assertions only). */
export const db = {
  async app(id: string) {
    const { data } = await admin.from("applications").select("*").eq("id", id).maybeSingle();
    return data;
  },
  async activities(applicationId: string) {
    const { data } = await admin
      .from("application_activities")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    return data ?? [];
  },
  async notes(applicationId: string) {
    const { data } = await admin
      .from("application_notes")
      .select("*")
      .eq("application_id", applicationId);
    return data ?? [];
  },
  async companies(userId: string) {
    const { data } = await admin.from("companies").select("*").eq("user_id", userId);
    return data ?? [];
  },
  async jobs(userId: string) {
    const { data } = await admin.from("jobs").select("*").eq("user_id", userId);
    return data ?? [];
  },
  async apps(userId: string) {
    const { data } = await admin.from("applications").select("*").eq("user_id", userId);
    return data ?? [];
  },
  async receipts(userId: string) {
    const { data } = await admin.from("mutation_requests").select("*").eq("user_id", userId);
    return data ?? [];
  },
};
