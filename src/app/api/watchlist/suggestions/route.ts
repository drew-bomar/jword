import { servicesFor } from "@/server/services";
import { watchlistRead } from "@/server/watchlist-read";

export const GET = watchlistRead((session) =>
  servicesFor(session).suggestWatchesFromApplications(session.actor),
);
