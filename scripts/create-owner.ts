/**
 * Provision (or look up) the single owner account. Local or hosted: uses the service-role key,
 * so run it from a trusted shell only. Prints the user id to put in JWORD_OWNER_USER_ID.
 *
 *   JWORD_OWNER_EMAIL=you@example.com pnpm owner:create
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.JWORD_OWNER_EMAIL;

if (!url || !serviceKey || !email) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and JWORD_OWNER_EMAIL (in .env.local or the shell).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data: page, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const existing = page.users.find((u) => u.email?.toLowerCase() === email!.toLowerCase());
  if (existing) {
    console.log(`Owner already exists.\nJWORD_OWNER_USER_ID=${existing.id}`);
    return;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: email!, email_confirm: true });
  if (error) throw error;
  console.log(`Owner created.\nJWORD_OWNER_USER_ID=${data.user.id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
