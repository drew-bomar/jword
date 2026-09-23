import { captureTargetSchema, parseOrThrow } from "@jword/core";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

/** Capture extension (decision 017): current values and version of the chosen application. */
export const POST = extensionEndpoint(async (session, input) => {
  const { applicationId } = parseOrThrow(captureTargetSchema, input);
  const view = await servicesFor(session).getApplication(
    { applicationId, notesLimit: 1, activityLimit: 1 },
    session.actor,
  );
  return view.application;
});
