import Link from "next/link";
import { ExternalLinkIcon, InboxIcon, SearchXIcon } from "lucide-react";
import type { ApplicationOverview } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatRelative } from "@/lib/format";
import { InlinePrioritySelect, InlineStatusSelect } from "./inline-selects";

export function ApplicationsTable({
  items,
  hasMore,
  totalTracked,
  hasFilters,
}: {
  items: ApplicationOverview[];
  hasMore: boolean;
  totalTracked: number;
  hasFilters: boolean;
}) {
  if (totalTracked === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="size-6" aria-hidden />}
        title="No applications yet"
        description="Add your first application, or import your existing spreadsheet as CSV."
        actions={
          <>
            <Button asChild>
              <Link href="/applications/new">Add application</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/import">Import CSV</Link>
            </Button>
          </>
        }
      />
    );
  }
  if (items.length === 0 && hasFilters) {
    return (
      <EmptyState
        icon={<SearchXIcon className="size-6" aria-hidden />}
        title="No matching applications"
        description="Nothing matches the current search and filters."
        actions={
          <Button asChild variant="outline">
            <Link href="/">Clear filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop: dense table */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.applicationId} data-testid="application-row">
                <TableCell className="font-medium">
                  <Link href={`/applications/${item.applicationId}`} className="hover:underline focus-visible:underline">
                    {item.company}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/applications/${item.applicationId}`} className="truncate hover:underline focus-visible:underline">
                      {item.title}
                    </Link>
                    {item.jobUrl ? (
                      <a
                        href={item.jobUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open job posting for ${item.title} at ${item.company}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLinkIcon className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <InlineStatusSelect applicationId={item.applicationId} version={item.version} status={item.status} label={`${item.company} ${item.title}`} />
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-muted-foreground">{item.location ?? "—"}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{formatDate(item.appliedAt)}</TableCell>
                <TableCell>
                  <InlinePrioritySelect applicationId={item.applicationId} version={item.version} priority={item.priority} label={`${item.company} ${item.title}`} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  <time dateTime={item.lastActivityAt}>{formatRelative(item.lastActivityAt)}</time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-2 md:hidden" aria-label="Applications">
        {items.map((item) => (
          <li key={item.applicationId} className="rounded-lg border p-3" data-testid="application-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/applications/${item.applicationId}`} className="block truncate font-medium hover:underline">
                  {item.company}
                </Link>
                <Link href={`/applications/${item.applicationId}`} className="block truncate text-sm text-muted-foreground">
                  {item.title}
                </Link>
              </div>
              <InlinePrioritySelect applicationId={item.applicationId} version={item.version} priority={item.priority} label={`${item.company} ${item.title}`} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <InlineStatusSelect applicationId={item.applicationId} version={item.version} status={item.status} label={`${item.company} ${item.title}`} />
              <span>
                {item.location ? `${item.location} · ` : ""}Applied {formatDate(item.appliedAt)} · Updated {formatRelative(item.lastActivityAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <p className="text-xs text-muted-foreground">Showing the first {items.length} results. Narrow the search to see more.</p>
      ) : null}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-16 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}
