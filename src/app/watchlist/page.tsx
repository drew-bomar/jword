import type { Metadata } from "next";
import { isAtsProvider, WATCHLIST_WEB_PAGE_SIZE } from "@jword/core/browser";
import { AppShell } from "@/components/app-shell";
import { PageNavigation } from "@/components/page-navigation";
import { SuggestFromApplicationsDialog } from "@/features/watchlist/suggest-dialog";
import { AddWatchDialog } from "@/features/watchlist/watch-dialogs";
import {
  WatchFiltersBar,
  type WatchFilters,
  type WatchStateFilter,
} from "@/features/watchlist/watch-filters";
import { WatchlistTable } from "@/features/watchlist/watchlist-table";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Watchlist" };

function parseFilters(params: Record<string, string | string[] | undefined>): WatchFilters {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";
  const state = one("state");
  const provider = one("provider");
  return {
    q: one("q"),
    state: state === "active" || state === "inactive" ? (state as WatchStateFilter) : "all",
    provider: isAtsProvider(provider) ? provider : "",
  };
}

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const session = await requirePageSession();
  const params = await searchParams;
  const filters = parseFilters(params);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;

  const page = await servicesFor(session).listWatchedCompanies(
    {
      text: filters.q || undefined,
      active: filters.state === "all" ? undefined : filters.state === "active",
      provider: filters.provider || undefined,
      limit: WATCHLIST_WEB_PAGE_SIZE,
      cursor,
    },
    session.actor,
  );
  const hasFilters = Boolean(filters.q || filters.state !== "all" || filters.provider);

  return (
    <AppShell email={session.email}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Watchlist</h1>
            <p className="text-muted-foreground text-xs">
              Companies and the public job boards jword will check for them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SuggestFromApplicationsDialog />
            <AddWatchDialog />
          </div>
        </div>

        <WatchFiltersBar filters={filters} />
        <WatchlistTable
          items={page.items}
          hasFilters={hasFilters || Boolean(cursor)}
          hasMore={page.hasMore}
        />
        <PageNavigation
          pathname="/watchlist"
          params={params}
          cursorKey="cursor"
          current={cursor}
          next={page.nextCursor}
          label="Companies"
        />
      </div>
    </AppShell>
  );
}
