"use server";

import { z } from "zod";
import type { ApplicationDetail, ApplicationSummary } from "@jword/core/browser";
import { parseOrThrow, toSummary, uuidSchema } from "@jword/core";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

/**
 * Read-only helpers for the /capture page (decision 016). Saving a capture uses the existing
 * createApplicationAction / updateDetailsAction, so there is no capture-specific write path.
 */

const searchSchema = z.strictObject({ text: z.string().trim().min(1).max(200) });

/** Let the owner pick an application the duplicate check missed (e.g. "Acme" vs "Acme Inc."). */
export async function searchCaptureTargetsAction(
  input: unknown,
): Promise<ActionResult<{ items: ApplicationSummary[]; hasMore: boolean }>> {
  return runAction(async () => {
    const session = await requireSession();
    const { text } = parseOrThrow(searchSchema, input);
    const page = await servicesFor(session).searchApplications({ text, limit: 10 }, session.actor);
    return { items: page.items.map(toSummary), hasMore: page.hasMore };
  });
}

/** Current values and version of the application the owner chose to update. */
export async function getCaptureTargetAction(
  input: unknown,
): Promise<ActionResult<ApplicationDetail>> {
  return runAction(async () => {
    const session = await requireSession();
    const { applicationId } = parseOrThrow(z.strictObject({ applicationId: uuidSchema }), input);
    const view = await servicesFor(session).getApplication(
      { applicationId, notesLimit: 1, activityLimit: 1 },
      session.actor,
    );
    return view.application;
  });
}
