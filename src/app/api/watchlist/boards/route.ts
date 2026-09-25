import { servicesFor } from "@/server/services";
import { watchlistRead } from "@/server/watchlist-read";

export const GET = watchlistRead((session, input, signal) =>
  servicesFor(session).discoverCompanyBoards(input, session.actor, { signal }),
);
