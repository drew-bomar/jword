import { loadTestEnv } from "../test-env";

// Integration tests run against the local Supabase stack (`pnpm db:start`) using .env.test.local.
loadTestEnv();

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(
    `Integration tests need ${missing.join(", ")}. Run \`pnpm db:start\`, then create .env.test.local ` +
      "using the values printed by `pnpm db:status -o env`.",
  );
}
