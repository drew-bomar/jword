"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  LEAD_AVAILABILITIES,
  LEAD_AVAILABILITY_LABELS,
  LEAD_REVIEW_LABELS,
  LEAD_REVIEW_STATUSES,
  type LeadAvailability,
  type LeadCompany,
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
import { DEFAULT_LEAD_STATUS, type LeadFilters, type LeadStatusFilter } from "./filters";

const ALL = "__all__";

/** Filter state lives in the URL, like the applications and watchlist tables. */
export function LeadFiltersBar({
  filters,
  companies,
}: {
  filters: LeadFilters;
  companies: LeadCompany[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [urlQ, setUrlQ] = useState(filters.q);
  const [, startTransition] = useTransition();

  if (filters.q !== urlQ) {
    setUrlQ(filters.q);
    setQ(filters.q);
  }

  function update(patch: Partial<LeadFilters>) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("cursor");
    const merged = { ...filters, q, ...patch };
    const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
    set("q", merged.q.trim());
    set("company", merged.company);
    set("status", merged.status === DEFAULT_LEAD_STATUS ? "" : merged.status.toLowerCase());
    set("availability", merged.availability.toLowerCase());
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === filters.q) return;
    const handle = setTimeout(() => update({ q }), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = Boolean(
    filters.q || filters.company || filters.status !== DEFAULT_LEAD_STATUS || filters.availability,
  );

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Label htmlFor="lead-search" className="sr-only">
          Search leads by title, company, or location
        </Label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="lead-search"
          type="search"
          placeholder="Search title, company, location…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="lead-company" className="text-muted-foreground text-xs">
          Company
        </Label>
        <Select
          value={filters.company || ALL}
          onValueChange={(v) => update({ company: v === ALL ? "" : v })}
        >
          <SelectTrigger id="lead-company" className="w-[170px]" aria-label="Filter by company">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.companyId} value={c.companyId}>
                {c.company} ({c.leadCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lead-status" className="text-muted-foreground text-xs">
          Review
        </Label>
        <Select
          value={filters.status}
          onValueChange={(v) => update({ status: v as LeadStatusFilter })}
        >
          <SelectTrigger
            id="lead-status"
            className="w-[170px]"
            aria-label="Filter by review status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_REVIEW_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {LEAD_REVIEW_LABELS[s]}
              </SelectItem>
            ))}
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="lead-availability" className="text-muted-foreground text-xs">
          Listing
        </Label>
        <Select
          value={filters.availability || ALL}
          onValueChange={(v) => update({ availability: v === ALL ? "" : (v as LeadAvailability) })}
        >
          <SelectTrigger
            id="lead-availability"
            className="w-[160px]"
            aria-label="Filter by listing status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any</SelectItem>
            {LEAD_AVAILABILITIES.map((a) => (
              <SelectItem key={a} value={a}>
                {LEAD_AVAILABILITY_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQ("");
            update({ q: "", company: "", status: DEFAULT_LEAD_STATUS, availability: "" });
          }}
        >
          <XIcon data-icon="inline-start" aria-hidden />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
