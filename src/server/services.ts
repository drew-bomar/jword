import {
  createClock,
  createCachedBoardDirectory,
  createFixtureBoardDirectory,
  createFixtureJobCollector,
  createPublicBoardDirectory,
  createPublicJobCollector,
  createTrackerServices,
  E2E_FIXTURE_BOARDS,
  E2E_FIXTURE_POSTINGS,
  stderrLogger,
  SupabaseTrackerRepository,
  type BoardDirectory,
  type JobCollector,
  type TrackerServices,
} from "@jword/core";
import { serverEnv } from "@/lib/env";
import type { WebSession } from "@/server/auth/session";
import { assertBoardDirectoryEnvironment } from "./board-directory-env";

let directory: BoardDirectory | undefined;

/**
 * Public job-board lookups (decision 019). Browser tests set JWORD_BOARD_DIRECTORY=fixtures so
 * they never call Greenhouse, Lever, Ashby, or Workday.
 */
function boardDirectory(): BoardDirectory {
  assertBoardDirectoryEnvironment(process.env);
  directory ??=
    process.env.JWORD_BOARD_DIRECTORY === "fixtures"
      ? createFixtureBoardDirectory(E2E_FIXTURE_BOARDS)
      : createCachedBoardDirectory(createPublicBoardDirectory());
  return directory;
}

let collector: JobCollector | undefined;

/**
 * Reads every posting on a watched board (decision 024). Uses the same fixture switch and
 * guard as board discovery, so browser tests never call real providers.
 */
function jobCollector(): JobCollector {
  assertBoardDirectoryEnvironment(process.env);
  collector ??=
    process.env.JWORD_BOARD_DIRECTORY === "fixtures"
      ? createFixtureJobCollector(E2E_FIXTURE_POSTINGS)
      : createPublicJobCollector();
  return collector;
}

/** Shared services bound to the signed-in user's own Supabase client (RLS applies). */
export function servicesFor(session: WebSession): TrackerServices {
  return createTrackerServices({
    repository: new SupabaseTrackerRepository(session.supabase),
    clock: createClock(serverEnv().timeZone),
    logger: stderrLogger,
    boardDirectory: boardDirectory(),
    jobCollector: jobCollector(),
  });
}
