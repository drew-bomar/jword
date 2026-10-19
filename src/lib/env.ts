import { resolveTimeZone } from "@jword/core/browser";
import { parseExtensionIds } from "@/server/extension-origin";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

/** Public values are safe for the browser; everything else stays on the server. */
export function publicEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function serverEnv() {
  return {
    ...publicEnv(),
    timeZone: resolveTimeZone(process.env.JWORD_TIMEZONE),
    /** The only user with discovery features (decision 027). Unset: nobody. */
    ownerUserId: process.env.JWORD_OWNER_USER_ID?.trim() || null,
    /** Capture extensions allowed to call /api/extension/* (decisions 017, 027). Empty: API off. */
    extensionIds: parseExtensionIds(
      process.env.JWORD_EXTENSION_IDS,
      process.env.JWORD_EXTENSION_ID,
    ),
  };
}
