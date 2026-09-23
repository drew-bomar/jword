import { captureSearchSchema, parseOrThrow, toSummary } from "@jword/core";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

/** Capture extension (decision 017): let the owner pick an application the match check missed. */
export const POST = extensionEndpoint(async (session, input) => {
  const { text } = parseOrThrow(captureSearchSchema, input);
  const page = await servicesFor(session).searchApplications({ text, limit: 10 }, session.actor);
  return { items: page.items.map(toSummary), hasMore: page.hasMore };
});
