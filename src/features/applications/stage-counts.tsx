import Link from "next/link";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type ApplicationStatus,
  type StatusCounts,
} from "@jword/core/browser";
import { cn } from "@/lib/utils";
import type { Filters } from "./filters-bar";

function hrefFor(filters: Filters, status: ApplicationStatus | "") {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.sort !== "updated") params.set("sort", filters.sort);
  if (filters.dir) params.set("dir", filters.dir);
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** Basic counts by stage; each chip doubles as a status filter. */
export function StageCounts({
  counts,
  activeStatus,
  filters,
}: {
  counts: StatusCounts;
  activeStatus: ApplicationStatus | "";
  filters: Filters;
}) {
  return (
    <nav aria-label="Counts by stage" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1.5">
        {APPLICATION_STATUSES.map((status) => {
          const active = activeStatus === status;
          return (
            <li key={status}>
              <Link
                href={hrefFor(filters, active ? "" : status)}
                aria-pressed={active}
                className={cn(
                  "hover:bg-muted focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors focus-visible:ring-3 focus-visible:outline-none",
                  active ? "border-foreground/40 bg-muted" : "border-border",
                  counts.byStatus[status] === 0 && !active && "text-muted-foreground",
                )}
              >
                <span>{STATUS_LABELS[status]}</span>
                <span className="bg-background rounded px-1 font-mono text-[11px] tabular-nums">
                  {counts.byStatus[status]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
