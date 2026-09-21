import { readFileSync } from "node:fs";
import { z } from "zod";
import { DEFAULT_TIMEZONE, resolveTimeZone } from "@jword/core";

export interface McpEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  ownerUserId: string;
  timeZone: string;
}

const envSchema = z.object({
  SUPABASE_URL: z.url({ error: "SUPABASE_URL must be a URL." }),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY is missing or too short."),
  JWORD_OWNER_USER_ID: z.guid({ error: "JWORD_OWNER_USER_ID must be a UUID." }),
  JWORD_TIMEZONE: z.string().optional(),
});

/** Minimal KEY=VALUE parser for an optional untracked env file (JWORD_ENV_FILE). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Validate the process environment. Throws an Error whose message names variables only;
 * values are never included so the message is safe to print.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  const merged: Record<string, string | undefined> = { ...source };
  const envFile = source.JWORD_ENV_FILE;
  if (envFile) {
    let text: string;
    try {
      text = readFileSync(envFile, "utf8");
    } catch {
      throw new Error(`JWORD_ENV_FILE is set but the file could not be read.`);
    }
    for (const [key, value] of Object.entries(parseEnvFile(text))) {
      if (merged[key] === undefined || merged[key] === "") merged[key] = value;
    }
  }

  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "env")))];
    throw new Error(
      `Invalid or missing environment variables: ${names.join(", ")}. ` +
        `Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWORD_OWNER_USER_ID (optional: JWORD_TIMEZONE, JWORD_ENV_FILE).`,
    );
  }
  return {
    supabaseUrl: parsed.data.SUPABASE_URL,
    serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    ownerUserId: parsed.data.JWORD_OWNER_USER_ID,
    timeZone: resolveTimeZone(parsed.data.JWORD_TIMEZONE ?? DEFAULT_TIMEZONE),
  };
}
