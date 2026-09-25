import {
  createClock,
  createCachedBoardDirectory,
  createFixtureBoardDirectory,
  createPublicBoardDirectory,
  createTrackerServices,
  E2E_FIXTURE_BOARDS,
  stderrLogger,
  SupabaseTrackerRepository,
  type BoardDirectory,
  type TrackerServices,
} from "@jword/core";
import { serverEnv } from "@/lib/env";
import type { WebSession } from "@/server/auth/session";
import { assertBoardDirectoryEnvironment } from "./board-directory-env";

let directory: BoardDirectory | undefined;

/**
 * Public job-board lookups (decision 019). Browser tests set JWORD_BOARD_DIRECTORY=fixtures so
 * they never call Greenhouse, Lever, or Ashby.
 */
function boardDirectory(): BoardDirectory {
  assertBoardDirectoryEnvironment(process.env);
  directory ??=
    process.env.JWORD_BOARD_DIRECTORY === "fixtures"
      ? createFixtureBoardDirectory(E2E_FIXTURE_BOARDS)
      : createCachedBoardDirectory(createPublicBoardDirectory());
  return directory;
}

/** Shared services bound to the signed-in user's own Supabase client (RLS applies). */
export function servicesFor(session: WebSession): TrackerServices {
  return createTrackerServices({
    repository: new SupabaseTrackerRepository(session.supabase),
    clock: createClock(serverEnv().timeZone),
    logger: stderrLogger,
    boardDirectory: boardDirectory(),
  });
}
