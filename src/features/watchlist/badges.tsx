import { EyeIcon, EyeOffIcon } from "lucide-react";
import { ATS_PROVIDER_LABELS, type AtsProvider } from "@jword/core/browser";
import { cn } from "@/lib/utils";

export function ProviderBadge({
  provider,
  className,
}: {
  provider: AtsProvider;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-muted text-foreground/80 inline-flex h-6 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {ATS_PROVIDER_LABELS[provider]}
    </span>
  );
}

/** Active/inactive with an icon and a word, so the state never relies on color alone. */
export function WatchStateBadge({ active }: { active: boolean }) {
  const Icon = active ? EyeIcon : EyeOffIcon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        active
          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function InterestLevel({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums" aria-label={`Interest ${value} of 5`}>
      {value}/5
    </span>
  );
}
