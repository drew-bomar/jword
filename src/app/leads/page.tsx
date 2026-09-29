import type { Metadata } from "next";
import Link from "next/link";
import {
  LEAD_AVAILABILITIES,
  LEAD_REVIEW_STATUSES,
  LEAD_ROLE_FILTERS,
  LEAD_SORTS,
  LEAD_VIEWS,
  type LeadAvailability,
  type LeadReviewStatus,
  type LeadRoleFilter,
  type LeadSort,
  type LeadView,
} from "@jword/core/browser";
import { AppShell } from "@/components/app-shell";
import { PageNavigation } from "@/components/page-navigation";
import { CheckAllJobs } from "@/features/leads/check-jobs";
import {
  DEFAULT_LEAD_SORT,
  DEFAULT_LEAD_STATUS,
  DEFAULT_LEAD_VIEW,
  type LeadFilters,
} from "@/features/leads/filters";
import { LeadViewTabs } from "@/features/leads/lead-view-tabs";
import { LeadFiltersBar } from "@/features/leads/lead-filters";
import { LeadsTable } from "@/features/leads/leads-table";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Leads" };
// "Check for new jobs" runs as a Server Action on this page and can read many boards.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseFilters(params: Record<string, string | string[] | undefined>): LeadFilters {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";
  const status = one("status").toUpperCase();
  const availability = one("availability").toUpperCase();
  const view = one("view").toUpperCase();
  const sort = one("sort").toUpperCase();
  const role = one("role").toUpperCase();
  const pick = <T extends string>(values: readonly T[], value: string, fallback: T | "") =>
    (values as readonly string[]).includes(value) ? (value as T) : fallback;
  return {
    q: one("q"),
    company: UUID.test(one("company")) ? one("company") : "",
    status:
      status === "ALL"
        ? "all"
        : (LEAD_REVIEW_STATUSES as readonly string[]).includes(status)
          ? (status as LeadReviewStatus)
          : DEFAULT_LEAD_STATUS,
    availability: (LEAD_AVAILABILITIES as readonly string[]).includes(availability)
      ? (availability as LeadAvailability)
      : "",
    view: pick<LeadView>(LEAD_VIEWS, view, DEFAULT_LEAD_VIEW) as LeadView,
    sort: pick<LeadSort>(LEAD_SORTS, sort, DEFAULT_LEAD_SORT) as LeadSort,
    role: pick<LeadRoleFilter>(LEAD_ROLE_FILTERS, role, ""),
  };
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const session = await requirePageSession();
  const params = await searchParams;
  const filters = parseFilters(params);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const services = servicesFor(session);

  const [page, companies, watches, preferences] = await Promise.all([
    services.listLeads(
      {
        text: filters.q || undefined,
        companyId: filters.company || undefined,
        reviewStatus: filters.status === "all" ? undefined : filters.status,
        availability: filters.availability || undefined,
        view: filters.view,
        sort: filters.sort,
        role: filters.role || undefined,
        cursor,
      },
      session.actor,
    ),
    services.listLeadCompanies(session.actor),
    services.listWatchedCompanies({ limit: 1 }, session.actor),
    services.getSearchPreferences(session.actor),
  ]);
  const hasFilters = Boolean(
    filters.q ||
    filters.company ||
    filters.status !== DEFAULT_LEAD_STATUS ||
    filters.availability ||
    filters.view !== DEFAULT_LEAD_VIEW ||
    filters.role ||
    cursor,
  );

  return (
    <AppShell email={session.email}>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground text-xs">
            Postings collected from your watched companies&apos; job boards. Dismiss what does not
            fit; create an application from what does.{" "}
            <Link href="/settings/preferences" className="underline underline-offset-2">
              {preferences ? "Search preferences" : "Set search preferences"}
            </Link>{" "}
            decide what is filtered.
          </p>
        </div>

        <CheckAllJobs />
        <LeadViewTabs view={filters.view} hideRemoteOnly={preferences?.hideRemoteOnly ?? false} />
        <LeadFiltersBar filters={filters} companies={companies} />
        <LeadsTable
          items={page.items}
          hasFilters={hasFilters}
          hasMore={page.hasMore}
          hasWatches={watches.items.length > 0}
        />
        <PageNavigation
          pathname="/leads"
          params={params}
          cursorKey="cursor"
          current={cursor}
          next={page.nextCursor}
          label="Leads"
        />
      </div>
    </AppShell>
  );
}
