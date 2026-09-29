"use server";

import { revalidatePath } from "next/cache";
import type { PreferencesMutationResult } from "@jword/core/browser";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

/**
 * Save the whole search-preference set (decision 026). The shared service validates it,
 * checks the version, and re-evaluates existing leads without changing their review status,
 * availability, or version.
 */
export async function saveSearchPreferencesAction(
  input: unknown,
): Promise<ActionResult<PreferencesMutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).saveSearchPreferences(input, session.actor);
    revalidatePath("/settings/preferences");
    revalidatePath("/leads");
    return result;
  });
}
