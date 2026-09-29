"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LEAD_VIEW_LABELS, LEAD_VIEWS, type LeadView } from "@jword/core/browser";
import { cn } from "@/lib/utils";
import { DEFAULT_LEAD_VIEW } from "./filters";

const HINTS: Record<LeadView, (hideRemoteOnly: boolean) => string> = {
  RECOMMENDED: (hide) =>
    hide
      ? "Leads that pass your preferences, without remote-only roles."
      : "Leads that pass your preferences.",
  REMOTE: () => "Remote-only roles that pass your preferences.",
  FILTERED: () =>
    "Saved leads your current preferences exclude. Nothing here was deleted or dismissed.",
  ALL: () => "Every saved lead, whatever its evaluation.",
};

/** Decision 026 views, kept in the URL like the other lead filters. */
export function LeadViewTabs({
  view,
  hideRemoteOnly,
}: {
  view: LeadView;
  hideRemoteOnly: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hrefFor = (next: LeadView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    if (next === DEFAULT_LEAD_VIEW) params.delete("view");
    else params.set("view", next.toLowerCase());
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  return (
    <div className="space-y-1">
      <nav aria-label="Lead views" className="flex flex-wrap gap-1">
        {LEAD_VIEWS.map((option) => (
          <Link
            key={option}
            href={hrefFor(option)}
            scroll={false}
            aria-current={option === view ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              option === view && "bg-muted text-foreground border-foreground/20",
            )}
          >
            {LEAD_VIEW_LABELS[option]}
          </Link>
        ))}
      </nav>
      <p className="text-muted-foreground text-xs">{HINTS[view](hideRemoteOnly)}</p>
    </div>
  );
}
