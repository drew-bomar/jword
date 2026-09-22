"use server";

import { revalidatePath } from "next/cache";
import type { CandidateProfile } from "@jword/core/browser";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

export async function saveProfileAction(input: unknown): Promise<ActionResult<CandidateProfile>> {
  return runAction(async () => {
    const session = await requireSession();
    const profile = await servicesFor(session).saveCandidateProfile(input, session.actor);
    revalidatePath("/settings/profile");
    return profile;
  });
}
