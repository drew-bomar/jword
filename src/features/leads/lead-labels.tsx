import {
  CITY_CATALOG,
  EXCLUSION_LABELS,
  FLAG_LABELS,
  LEAD_ARRANGEMENT_LABELS,
  parseLeadEvaluation,
  type Lead,
} from "@jword/core/browser";
import { cn } from "@/lib/utils";

function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "caution" | "excluded";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "good" && "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        tone === "caution" && "bg-amber-500/15 text-amber-900 dark:text-amber-300",
        tone === "excluded" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Deterministic evaluation labels (decision 026). Every flag and exclusion shows the text it
 * matched on hover, so the reason is never a mystery. Labels use words, not color alone.
 */
export function LeadLabels({ lead }: { lead: Lead }) {
  const evaluation = parseLeadEvaluation(lead.evaluation);
  if (!evaluation) return null;
  const city = evaluation.cities[0];
  return (
    <div className="flex flex-wrap gap-1" data-testid="lead-labels">
      {evaluation.exclusions.map((finding) => (
        <Chip
          key={finding.code}
          tone="excluded"
          title={`Matched in ${finding.field}: ${finding.evidence}`}
        >
          {EXCLUSION_LABELS[finding.code]}
        </Chip>
      ))}
      {evaluation.flags.map((finding) => (
        <Chip
          key={finding.code}
          tone="caution"
          title={`From ${finding.field}: ${finding.evidence}`}
        >
          {FLAG_LABELS[finding.code]}
        </Chip>
      ))}
      {evaluation.arrangement !== "UNKNOWN" ? (
        <Chip>{LEAD_ARRANGEMENT_LABELS[evaluation.arrangement]}</Chip>
      ) : null}
      {city && evaluation.cityRank ? (
        <Chip tone="good" title={`Preferred city #${evaluation.cityRank}`}>
          {CITY_CATALOG[city].label}
        </Chip>
      ) : null}
      {evaluation.roleFit === "PREFERRED" ? <Chip tone="good">Preferred role</Chip> : null}
      {evaluation.roleFit === "DEEMPHASIZED" ? <Chip>De-emphasized role</Chip> : null}
      {evaluation.startFit === "EARLIER" ? (
        <Chip title={`Stated start ${evaluation.startMonth}`}>Earlier start</Chip>
      ) : null}
    </div>
  );
}
