import Link from "next/link";
import { ExternalLinkIcon, RadarIcon, SearchXIcon } from "lucide-react";
import { ACTOR_LABELS, type WatchedCompany } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { InterestLevel, ProviderBadge, WatchStateBadge } from "./badges";
import { AddWatchDialog, EditWatchDialog } from "./watch-dialogs";
import { WatchStatusButton } from "./watch-status-button";

function Board({ watch }: { watch: WatchedCompany }) {
  const label = watch.provider === "OTHER" ? "Careers page" : watch.boardIdentifier;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ProviderBadge provider={watch.provider} />
      {watch.boardUrl ? (
        <a
          href={watch.boardUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:underline"
          aria-label={`Open ${watch.company} ${watch.provider === "OTHER" ? "careers page" : "job board"}`}
        >
          <span className="truncate">{label}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
        </a>
      ) : (
        <span className="text-muted-foreground text-xs">No board</span>
      )}
    </span>
  );
}

function ApplicationsLink({ watch }: { watch: WatchedCompany }) {
  if (watch.applicationCount === 0) return null;
  return (
    <Link
      href={`/?q=${encodeURIComponent(watch.company)}`}
      className="text-muted-foreground hover:text-foreground text-xs hover:underline"
    >
      {watch.applicationCount} application{watch.applicationCount === 1 ? "" : "s"}
    </Link>
  );
}

function LastChange({ watch }: { watch: WatchedCompany }) {
  if (!watch.lastEvent) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground text-xs">
      {watch.lastEvent.summary} · {ACTOR_LABELS[watch.lastEvent.actorType]} ·{" "}
      <time dateTime={watch.lastEvent.occurredAt}>
        {formatRelative(watch.lastEvent.occurredAt)}
      </time>
    </span>
  );
}

function Actions({ watch }: { watch: WatchedCompany }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <EditWatchDialog watch={watch} />
      <WatchStatusButton
        watchId={watch.watchId}
        version={watch.version}
        active={watch.active}
        company={watch.company}
      />
    </div>
  );
}

export function WatchlistTable({
  items,
  hasFilters,
  hasMore,
}: {
  items: WatchedCompany[];
  hasFilters: boolean;
  hasMore: boolean;
}) {
  if (items.length === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={<RadarIcon className="size-6" aria-hidden />}
        title="No watched companies yet"
        description="Add a company whose public job board you want jword to check later. Paste a Greenhouse, Lever, or Ashby board URL to fill in the details."
        actions={<AddWatchDialog />}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<SearchXIcon className="size-6" aria-hidden />}
        title="No matching companies"
        description="Nothing on your watchlist matches the current search and filters."
        actions={
          <Button asChild variant="outline">
            <Link href="/watchlist">Clear filters</Link>
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
              <TableHead>Board</TableHead>
              <TableHead>Interest</TableHead>
              <TableHead>Monitoring</TableHead>
              <TableHead>Last change</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((watch) => (
              <TableRow key={watch.watchId} data-testid="watch-row">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{watch.company}</span>
                    <ApplicationsLink watch={watch} />
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <Board watch={watch} />
                </TableCell>
                <TableCell>
                  <InterestLevel value={watch.interestLevel} />
                </TableCell>
                <TableCell>
                  <WatchStateBadge active={watch.active} />
                </TableCell>
                <TableCell className="max-w-[280px] whitespace-normal">
                  <LastChange watch={watch} />
                </TableCell>
                <TableCell>
                  <Actions watch={watch} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-2 md:hidden" aria-label="Watched companies">
        {items.map((watch) => (
          <li key={watch.watchId} className="rounded-lg border p-3" data-testid="watch-card">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{watch.company}</span>
                <ApplicationsLink watch={watch} />
              </div>
              <WatchStateBadge active={watch.active} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <Board watch={watch} />
              <span className="text-muted-foreground">
                Interest <InterestLevel value={watch.interestLevel} />
              </span>
            </div>
            <div className="mt-1">
              <LastChange watch={watch} />
            </div>
            <div className="mt-2">
              <Actions watch={watch} />
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <p className="text-muted-foreground text-xs">
          Showing {items.length} companies on this page. More are available below.
        </p>
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
      <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-full">
        {icon}
      </div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}
