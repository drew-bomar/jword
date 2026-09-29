import Link from "next/link";
import { ExternalLinkIcon, InboxIcon, SearchXIcon } from "lucide-react";
import { LEAD_AVAILABILITY_LABELS, LEAD_REVIEW_LABELS, type Lead } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/features/watchlist/badges";
import { LeadActions } from "./lead-actions";
import { LeadLabels } from "./lead-labels";

function Title({ lead }: { lead: Lead }) {
  return (
    <a
      href={lead.jobUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-w-0 items-center gap-1 font-medium hover:underline"
      aria-label={`Open posting: ${lead.title} (opens in a new tab)`}
    >
      <span className="truncate">{lead.title}</span>
      <ExternalLinkIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

/** Listed / no longer listed, with a word so it never relies on color alone. */
function Availability({ lead }: { lead: Lead }) {
  const listed = lead.availability === "AVAILABLE";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
        listed
          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
      title={
        lead.unavailableAt ? `Not found since ${formatRelative(lead.unavailableAt)}` : undefined
      }
    >
      {LEAD_AVAILABILITY_LABELS[lead.availability]}
    </span>
  );
}

function Review({ lead }: { lead: Lead }) {
  return (
    <span className="text-muted-foreground text-xs whitespace-nowrap">
      {LEAD_REVIEW_LABELS[lead.reviewStatus]}
    </span>
  );
}

function Found({ lead }: { lead: Lead }) {
  return (
    <span className="text-muted-foreground text-xs">
      <time dateTime={lead.firstSeenAt}>{formatRelative(lead.firstSeenAt)}</time>
      {lead.postedOn ? ` · posted ${formatDate(lead.postedOn)}` : ""}
    </span>
  );
}

export function LeadsTable({
  items,
  hasFilters,
  hasMore,
  hasWatches,
}: {
  items: Lead[];
  hasFilters: boolean;
  hasMore: boolean;
  hasWatches: boolean;
}) {
  if (items.length === 0 && !hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-16 text-center">
        <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-full">
          <InboxIcon className="size-6" aria-hidden />
        </div>
        <h2 className="text-sm font-medium">No new leads</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {hasWatches
            ? "Check for new jobs to read your watched companies' boards. New postings appear here."
            : "Watch companies first; jword then reads their job boards for new postings."}
        </p>
        {hasWatches ? null : (
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href="/watchlist">Go to watchlist</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-16 text-center">
        <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-full">
          <SearchXIcon className="size-6" aria-hidden />
        </div>
        <h2 className="text-sm font-medium">No matching leads</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          Nothing matches the current view, search, and filters.
        </p>
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href="/leads?status=all">Show all leads</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Found</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((lead) => (
              <TableRow key={lead.leadId} data-testid="lead-row">
                <TableCell className="max-w-[320px]">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Title lead={lead} />
                    <Review lead={lead} />
                    <LeadLabels lead={lead} />
                  </div>
                </TableCell>
                <TableCell>{lead.company}</TableCell>
                <TableCell
                  className="text-muted-foreground max-w-[200px] truncate text-xs"
                  title={lead.locations.length > 1 ? lead.locations.join(" · ") : undefined}
                >
                  {lead.location ?? "—"}
                  {lead.locations.length > 1 ? ` +${lead.locations.length - 1}` : ""}
                </TableCell>
                <TableCell>
                  <ProviderBadge provider={lead.provider} />
                </TableCell>
                <TableCell>
                  <Availability lead={lead} />
                </TableCell>
                <TableCell>
                  <Found lead={lead} />
                </TableCell>
                <TableCell>
                  <LeadActions lead={lead} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label="Leads">
        {items.map((lead) => (
          <li key={lead.leadId} className="rounded-lg border p-3" data-testid="lead-card">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <Title lead={lead} />
                <span className="text-sm">{lead.company}</span>
              </div>
              <Availability lead={lead} />
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <ProviderBadge provider={lead.provider} />
              {lead.location ? <span>{lead.location}</span> : null}
              <Review lead={lead} />
            </div>
            <div className="mt-1 space-y-1">
              <LeadLabels lead={lead} />
              <Found lead={lead} />
            </div>
            <div className="mt-2">
              <LeadActions lead={lead} />
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <p className="text-muted-foreground text-xs">
          Showing {items.length} leads on this page. More are available below.
        </p>
      ) : null}
    </div>
  );
}
