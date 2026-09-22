import {
  createClock,
  createTrackerServices,
  stderrLogger,
  SupabaseTrackerRepository,
  type TrackerServices,
} from "@jword/core";
import { serverEnv } from "@/lib/env";
import type { WebSession } from "@/server/auth/session";

/** Shared services bound to the signed-in user's own Supabase client (RLS applies). */
export function servicesFor(session: WebSession): TrackerServices {
  return createTrackerServices({
    repository: new SupabaseTrackerRepository(session.supabase),
    clock: createClock(serverEnv().timeZone),
    logger: stderrLogger,
  });
}
