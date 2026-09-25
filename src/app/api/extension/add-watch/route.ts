import { revalidatePath } from "next/cache";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

export const POST = extensionEndpoint(async (session, input) => {
  const result = await servicesFor(session).addWatchedCompany(input, session.actor);
  revalidatePath("/watchlist");
  return result;
});
