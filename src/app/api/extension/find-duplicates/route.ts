import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

/** Capture extension (decision 017): applications that look like the captured posting. */
export const POST = extensionEndpoint((session, input) =>
  servicesFor(session).findDuplicateCandidates(input, session.actor),
);
