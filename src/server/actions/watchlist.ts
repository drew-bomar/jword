"use server";

import { revalidatePath } from "next/cache";
import type { CompanyOption, WatchMutationResult } from "@jword/core/browser";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

/** Inputs are `unknown` on purpose: the shared Zod schemas validate inside the services. */
export async function addWatchAction(input: unknown): Promise<ActionResult<WatchMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).addWatchedCompany(input, session.actor);
    revalidatePath("/watchlist");
    return result;
  });
}

export async function updateWatchAction(
  input: unknown,
): Promise<ActionResult<WatchMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).updateWatchedCompany(input, session.actor);
    revalidatePath("/watchlist");
    return result;
  });
}

export async function setWatchStatusAction(
  input: unknown,
): Promise<ActionResult<WatchMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).setCompanyWatchStatus(input, session.actor);
    revalidatePath("/watchlist");
    return result;
  });
}

/** Read-only: existing companies for the add form's picker. */
export async function searchCompaniesAction(
  input: unknown,
): Promise<ActionResult<CompanyOption[]>> {
  return runAction(async () => {
    const session = await requireSession();
    return servicesFor(session).searchCompanies(input, session.actor);
  });
}
