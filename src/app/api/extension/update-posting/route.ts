import { revalidatePath } from "next/cache";
import { capturePostingUpdateSchema, parseOrThrow, safeMutationResult } from "@jword/core";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

/**
 * Capture extension (decision 017): write the posting fields the owner ticked to an existing
 * application. The narrower schema rejects anything but posting fields; the shared service then
 * validates the command again and applies the version check, retry receipt, and activity.
 */
export const POST = extensionEndpoint(async (session, input) => {
  const command = parseOrThrow(capturePostingUpdateSchema, input);
  const result = await servicesFor(session).updateApplicationDetails(command, session.actor);
  revalidatePath("/");
  revalidatePath(`/applications/${result.applicationId}`);
  return safeMutationResult(result);
});
