import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

export const POST = extensionEndpoint((session, input) =>
  servicesFor(session).searchCompanies(input, session.actor),
);
