import { canUseDiscovery } from "@/server/auth/session";
import { extensionEndpoint } from "@/server/extension-api";

/**
 * Capture extension (decision 027): which account the overlay saves to, and whether it may offer
 * "Watch this company". Signed out answers 401 like every endpoint. Nothing else is returned.
 */
export const POST = extensionEndpoint(async (session) => ({
  email: session.email,
  discovery: canUseDiscovery(session),
}));
