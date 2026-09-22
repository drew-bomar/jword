import path from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Load test environment and refuse to run against a hosted project.
 *
 * Precedence: `.env.test.local` (local-stack values, wins) then `.env.local` (may point at the
 * hosted tracker). Integration and e2e tests create and delete throwaway users, so they must only
 * ever talk to the local Supabase stack unless JWORD_ALLOW_REMOTE_TESTS=1 is set deliberately.
 */
export function loadTestEnv(): void {
  const root = process.cwd();
  loadEnv({ path: path.resolve(root, ".env.test.local"), quiet: true });
  loadEnv({ path: path.resolve(root, ".env.local"), quiet: true });

  const urls = [
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_DB_URL,
  ].filter(Boolean) as string[];
  const isLocal = (url: string) => {
    try {
      return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
    } catch {
      return false;
    }
  };
  if (process.env.JWORD_ALLOW_REMOTE_TESTS !== "1" && urls.some((url) => !isLocal(url))) {
    throw new Error(
      "Refusing to run tests against a non-local Supabase URL. Tests create and delete users. " +
        "Put the local stack values (from `pnpm exec supabase status -o env`) in .env.test.local, " +
        "or set JWORD_ALLOW_REMOTE_TESTS=1 if you really mean it.",
    );
  }
}
