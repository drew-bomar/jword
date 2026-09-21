"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ApplicationPriority,
  type ApplicationStatus,
  type SearchSort,
  type SortDirection,
} from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Filters {
  q: string;
  status: ApplicationStatus | "";
  priority: ApplicationPriority | "";
  sort: SearchSort;
  dir: SortDirection | "";
}

const SORT_LABELS: Record<SearchSort, string> = {
  updated: "Last updated",
  applied: "Date applied",
  company: "Company",
  priority: "Priority",
};

const ALL = "__all__";

/** Filter state lives in the URL so refreshes, back navigation, and sharing keep it. */
export function FiltersBar({ filters }: { filters: Filters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [urlQ, setUrlQ] = useState(filters.q);
  const [, startTransition] = useTransition();

  // When the URL changes underneath us (Clear filters, back navigation), adopt its value.
  if (filters.q !== urlQ) {
    setUrlQ(filters.q);
    setQ(filters.q);
  }

  function update(patch: Partial<Filters>) {
    const next = new URLSearchParams(searchParams.toString());
    const merged = { ...filters, q, ...patch };
    const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
    set("q", merged.q.trim());
    set("status", merged.status);
    set("priority", merged.priority);
    set("sort", merged.sort === "updated" ? "" : merged.sort);
    set("dir", merged.dir);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounce search typing into the URL; effects only talk to the router (an external system).
  useEffect(() => {
    if (q === filters.q) return;
    const handle = setTimeout(() => update({ q }), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = Boolean(filters.q || filters.status || filters.priority);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Label htmlFor="search" className="sr-only">
          Search by company or role
        </Label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="search"
          type="search"
          placeholder="Search company or role…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-status" className="text-muted-foreground text-xs">
          Status
        </Label>
        <Select
          value={filters.status || ALL}
          onValueChange={(v) => update({ status: v === ALL ? "" : (v as ApplicationStatus) })}
        >
          <SelectTrigger id="filter-status" className="w-[160px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {APPLICATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-priority" className="text-muted-foreground text-xs">
          Priority
        </Label>
        <Select
          value={filters.priority || ALL}
          onValueChange={(v) => update({ priority: v === ALL ? "" : (v as ApplicationPriority) })}
        >
          <SelectTrigger id="filter-priority" className="w-[130px]" aria-label="Filter by priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {APPLICATION_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sort" className="text-muted-foreground text-xs">
          Sort
        </Label>
        <div className="flex gap-1">
          <Select
            value={filters.sort}
            onValueChange={(v) => update({ sort: v as SearchSort, dir: "" })}
          >
            <SelectTrigger id="sort" className="w-[140px]" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SearchSort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            aria-label={`Sort direction: ${effectiveDirection(filters) === "asc" ? "ascending" : "descending"}. Toggle.`}
            onClick={() => update({ dir: effectiveDirection(filters) === "asc" ? "desc" : "asc" })}
          >
            {effectiveDirection(filters) === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>
      </div>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQ("");
            update({ q: "", status: "", priority: "" });
          }}
        >
          <XIcon data-icon="inline-start" aria-hidden />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

export function effectiveDirection(filters: Filters): SortDirection {
  if (filters.dir) return filters.dir;
  return filters.sort === "company" ? "asc" : "desc";
}
