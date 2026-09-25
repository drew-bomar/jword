import { servicesFor } from "@/server/services";
import { watchlistRead } from "@/server/watchlist-read";

export const GET = watchlistRead((session, input) =>
  servicesFor(session).searchCompanies(input, session.actor),
);
