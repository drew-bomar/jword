"use server";

import { revalidatePath } from "next/cache";
import type { DuplicateCandidate, MutationResult } from "@jword/core/browser";
import { safeMutationResult } from "@jword/core";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

function revalidateApplication(applicationId?: string) {
  revalidatePath("/");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

/** Inputs are `unknown` on purpose: the shared Zod schemas validate inside the services. */
export async function createApplicationAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).createApplication(input, session.actor);
    revalidateApplication(result.applicationId);
    return safeMutationResult(result);
  });
}

export async function findDuplicatesAction(input: unknown): Promise<ActionResult<DuplicateCandidate[]>> {
  return runAction(async () => {
    const session = await requireSession();
    return servicesFor(session).findDuplicateCandidates(input, session.actor);
  });
}

export async function updateStatusAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).updateApplicationStatus(input, session.actor);
    revalidateApplication(result.applicationId);
    return safeMutationResult(result);
  });
}

export async function updateDetailsAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).updateApplicationDetails(input, session.actor);
    revalidateApplication(result.applicationId);
    return safeMutationResult(result);
  });
}

export async function addNoteAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).addApplicationNote(input, session.actor);
    revalidateApplication(result.applicationId);
    return safeMutationResult(result);
  });
}

export async function updateNoteAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).updateApplicationNote(input, session.actor);
    revalidateApplication(result.applicationId);
    return safeMutationResult(result);
  });
}
