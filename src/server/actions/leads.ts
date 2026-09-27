"use server";

import { revalidatePath } from "next/cache";
import type { JobCheckResult, LeadMutationResult } from "@jword/core/browser";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

/** Inputs are `unknown` on purpose: the shared Zod schemas validate inside the services. */

/**
 * Check one watch ({ watchId }) or every active watch ({}) for new postings. Long-running:
 * pages that call it set maxDuration. It saves leads only; it never creates applications.
 */
export async function checkForNewJobsAction(input: unknown): Promise<ActionResult<JobCheckResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).checkForNewJobs(input, session.actor);
    revalidatePath("/leads");
    return result;
  });
}

export async function setLeadReviewStatusAction(
  input: unknown,
): Promise<ActionResult<LeadMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).setLeadReviewStatus(input, session.actor);
    revalidatePath("/leads");
    return result;
  });
}

export async function createApplicationFromLeadAction(
  input: unknown,
): Promise<ActionResult<LeadMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).createApplicationFromLead(input, session.actor);
    revalidatePath("/leads");
    revalidatePath("/");
    return result;
  });
}
