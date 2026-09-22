import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import {
  isApplicationPriority,
  isApplicationStatus,
  WEB_LIST_MAX_LIMIT,
  type SearchQuery,
  type SearchSort,
  type SortDirection,
} from "@jword/core/browser";
import { PageNavigation } from "@/components/page-navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ApplicationsTable } from "@/features/applications/applications-table";
import { FiltersBar, type Filters } from "@/features/applications/filters-bar";
import { StageCounts } from "@/features/applications/stage-counts";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Applications" };

const SORTS: SearchSort[] = ["updated", "applied", "company", "priority"];

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";
  const status = one("status");
  const priority = one("priority");
  const sort = one("sort");
  const dir = one("dir");
  return {
    q: one("q"),
    status: isApplicationStatus(status) ? status : "",
    priority: isApplicationPriority(priority) ? priority : "",
    sort: (SORTS as string[]).includes(sort) ? (sort as SearchSort) : "updated",
    dir: dir === "asc" || dir === "desc" ? (dir as SortDirection) : "",
  };
}

export default async function ApplicationsPage({ searchParams }: PageProps<"/">) {
  const session = await requirePageSession();
  const services = servicesFor(session);
  const params = await searchParams;
  const filters = parseFilters(params);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;

  const query: SearchQuery = {
    text: filters.q || undefined,
    statuses: filters.status ? [filters.status] : undefined,
    priorities: filters.priority ? [filters.priority] : undefined,
    sort: filters.sort,
    direction: filters.dir || undefined,
    limit: WEB_LIST_MAX_LIMIT,
    cursor,
  };

  const [page, counts] = await Promise.all([
    services.searchApplications(query, session.actor),
    services.getStatusCounts(session.actor),
  ]);
  const hasFilters = Boolean(filters.q || filters.status || filters.priority);

  return (
    <AppShell email={session.email}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Applications</h1>
            <p className="text-muted-foreground text-xs">
              {counts.total} tracked · {counts.active} active
            </p>
          </div>
          <Button asChild>
            <Link href="/applications/new">
              <PlusIcon data-icon="inline-start" aria-hidden />
              Add application
            </Link>
          </Button>
        </div>

        <StageCounts counts={counts} activeStatus={filters.status} filters={filters} />
        <FiltersBar filters={filters} />

        <ApplicationsTable
          items={page.items}
          hasMore={page.hasMore}
          totalTracked={counts.total}
          hasFilters={hasFilters}
        />
        <PageNavigation
          pathname="/"
          params={params}
          cursorKey="cursor"
          current={cursor}
          next={page.nextCursor}
          label="Applications"
        />
      </div>
    </AppShell>
  );
}
