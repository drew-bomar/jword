import { revalidatePath } from "next/cache";
import { safeMutationResult } from "@jword/core";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

/** Capture extension (decision 017): add the reviewed posting as a new application. */
export const POST = extensionEndpoint(async (session, input) => {
  const result = await servicesFor(session).createApplication(input, session.actor);
  revalidatePath("/");
  return safeMutationResult(result);
});
