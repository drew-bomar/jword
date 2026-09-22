import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@jword/core";

export type ServiceRoleClient = SupabaseClient<Database>;

/**
 * Service-role client for the local connector. This credential bypasses RLS, so every
 * repository call scopes by the configured owner and the key must never leave this process.
 */
export function createServiceRoleClient(url: string, serviceRoleKey: string): ServiceRoleClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Fail fast when JWORD_OWNER_USER_ID does not name a real user in this project. */
export async function verifyOwner(client: ServiceRoleClient, ownerUserId: string): Promise<void> {
  const { data, error } = await client.auth.admin.getUserById(ownerUserId);
  if (error || !data?.user) {
    throw new Error(
      "JWORD_OWNER_USER_ID does not match a user in the configured Supabase project (or the key cannot reach it).",
    );
  }
}
