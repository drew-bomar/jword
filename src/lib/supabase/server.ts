import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@jword/core";
import { publicEnv } from "@/lib/env";

/**
 * Per-request Supabase client bound to the browser session cookie.
 * Uses the public anon key only: Row Level Security applies to every query.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = publicEnv();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}
