"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { ATS_PROVIDER_LABELS, ATS_PROVIDERS, type AtsProvider } from "@jword/core/browser";
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

export type WatchStateFilter = "all" | "active" | "inactive";

export interface WatchFilters {
  q: string;
  state: WatchStateFilter;
  provider: AtsProvider | "";
}

const STATE_LABELS: Record<WatchStateFilter, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
};
const ALL = "__all__";

/** Filter state lives in the URL, like the applications table. */
export function WatchFiltersBar({ filters }: { filters: WatchFilters }) {
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

  function update(patch: Partial<WatchFilters>) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("cursor");
    const merged = { ...filters, q, ...patch };
    const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
    set("q", merged.q.trim());
    set("state", merged.state === "all" ? "" : merged.state);
    set("provider", merged.provider);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === filters.q) return;
    const handle = setTimeout(() => update({ q }), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = Boolean(filters.q || filters.state !== "all" || filters.provider);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Label htmlFor="watch-search" className="sr-only">
          Search by company name
        </Label>
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="watch-search"
          type="search"
          placeholder="Search company…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-state" className="text-muted-foreground text-xs">
          Monitoring
        </Label>
        <Select
          value={filters.state}
          onValueChange={(v) => update({ state: v as WatchStateFilter })}
        >
          <SelectTrigger id="filter-state" className="w-[130px]" aria-label="Filter by monitoring">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATE_LABELS) as WatchStateFilter[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-provider" className="text-muted-foreground text-xs">
          Provider
        </Label>
        <Select
          value={filters.provider || ALL}
          onValueChange={(v) => update({ provider: v === ALL ? "" : (v as AtsProvider) })}
        >
          <SelectTrigger id="filter-provider" className="w-[140px]" aria-label="Filter by provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All providers</SelectItem>
            {ATS_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {ATS_PROVIDER_LABELS[p]}
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
            update({ q: "", state: "all", provider: "" });
          }}
        >
          <XIcon data-icon="inline-start" aria-hidden />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
