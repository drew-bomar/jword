"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  Loader2Icon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import {
  EXCLUSION_LABELS,
  ATS_PROVIDER_LABELS,
  type BoardCheckReason,
  type BoardCheckReport,
  type BoardCheckStatus,
  type JobCheckResult,
} from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checkForNewJobsAction } from "@/server/actions/leads";

const REASON_TEXT: Record<BoardCheckReason, string> = {
  BOARD_NOT_FOUND: "the provider no longer serves this board",
  PROVIDER_ERROR: "the provider returned an error",
  INVALID_RESPONSE: "the provider's response was not in the expected format",
  TIME_LIMIT: "it took too long",
  PAGE_FAILED: "some pages could not be read",
  TOTAL_CAPPED: "Workday reports at most 2000 jobs, so the list may be incomplete",
  COUNT_MISMATCH: "jobs moved while paging, so some may have been missed",
  POSTING_LIMIT: "the board reached jword's posting limit, so the list may be incomplete",
  INVALID_POSTINGS: "some postings were malformed and skipped",
  UNSUPPORTED_BOARD: "careers pages cannot be read; add a supported board",
  IN_PROGRESS: "this board is already being checked; try again shortly",
  NOT_CHECKED: "the check ran out of time before this board",
  SAVE_FAILED: "not every posting could be saved",
  FINISH_UNCONFIRMED:
    "the scan's final result could not be confirmed; refresh leads and check again in five minutes",
};

const STATUS_ICON: Record<BoardCheckStatus, typeof CheckCircle2Icon> = {
  complete: CheckCircle2Icon,
  partial: AlertTriangleIcon,
  failed: XCircleIcon,
  unsupported: CircleSlashIcon,
};
const STATUS_WORD: Record<BoardCheckStatus, string> = {
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
  unsupported: "Not supported",
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "3 new, 1 updated" style counts for one board or the whole check. */
function counts(
  r: Pick<
    BoardCheckReport,
    "found" | "created" | "updated" | "relisted" | "markedUnavailable" | "filtered"
  >,
) {
  const parts = [`${r.created} new`, `${r.updated} updated`];
  if (r.relisted) parts.push(`${r.relisted} listed again`);
  if (r.markedUnavailable) parts.push(`${r.markedUnavailable} no longer listed`);
  if (r.filtered) parts.push(`${r.filtered} skipped by preferences`);
  return `${plural(r.found, "job")} read: ${parts.join(", ")}`;
}

export function summaryLine(result: JobCheckResult): string {
  const t = result.totals;
  const incomplete = t.partial + t.failed;
  return [
    `${plural(t.created, "new lead")}, ${t.updated} updated`,
    t.markedUnavailable ? `${t.markedUnavailable} no longer listed` : null,
    t.filtered ? `${t.filtered} skipped by preferences` : null,
    incomplete ? `${plural(incomplete, "board")} incomplete` : null,
    t.unsupported ? `${t.unsupported} not supported` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Per-board outcome list shown after a check. Partial and failed boards say why. */
export function CheckSummary({ result }: { result: JobCheckResult }) {
  const t = result.totals;
  return (
    <section
      aria-label="Last check"
      className="space-y-2 rounded-lg border p-3 text-sm"
      data-testid="check-summary"
    >
      <p className="font-medium" role="status">
        Checked {plural(t.boards, "board")}: {summaryLine(result)}
      </p>
      {t.boards === 0 ? (
        <p className="text-muted-foreground text-xs">
          No boards to check. Add boards to active companies on the{" "}
          <Link href="/watchlist" className="underline">
            watchlist
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-1">
          {result.boards.map((board) => {
            const Icon = STATUS_ICON[board.status];
            return (
              <li
                key={`${board.watchId}-${board.provider}-${board.boardIdentifier ?? board.boardUrl}`}
                className="flex gap-2 text-xs"
                data-testid="check-board"
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    board.status === "complete" && "text-emerald-600 dark:text-emerald-400",
                    board.status === "partial" && "text-amber-600 dark:text-amber-400",
                    board.status === "failed" && "text-destructive",
                    board.status === "unsupported" && "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{board.company}</span> ·{" "}
                  {board.provider === "OTHER"
                    ? "Careers page"
                    : `${ATS_PROVIDER_LABELS[board.provider]} ${board.boardIdentifier}`}{" "}
                  · {STATUS_WORD[board.status]}
                  {board.status !== "unsupported" && board.found + board.created > 0
                    ? `: ${counts(board)}`
                    : ""}
                  {board.reason ? ` (${REASON_TEXT[board.reason]})` : ""}
                  {board.status === "partial"
                    ? ". Unseen jobs kept their previous listing status."
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {t.filtered ? (
        <p className="text-muted-foreground text-xs" data-testid="check-filtered">
          Skipped new postings:{" "}
          {Object.entries(t.filteredReasons)
            .map(
              ([reason, count]) =>
                `${count} ${(EXCLUSION_LABELS as Record<string, string>)[reason]?.toLowerCase() ?? reason}`,
            )
            .join(", ")}
          . They were not saved; if you loosen your{" "}
          <Link href="/settings/preferences" className="underline">
            preferences
          </Link>
          , they appear on the next check.
        </p>
      ) : null}
    </section>
  );
}

function useJobCheck() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(input: { watchId?: string }, onDone: (result: JobCheckResult) => void) {
    startTransition(async () => {
      let result;
      try {
        result = await checkForNewJobsAction(input);
      } catch {
        toast.error(
          "The check was interrupted. Some results may have been saved. Refresh leads and try again in five minutes.",
        );
        return;
      }
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") {
          router.push("/sign-in");
          return;
        }
        toast.error(result.error.message);
        return;
      }
      onDone(result.data);
      router.refresh();
    });
  }
  return { pending, run, router };
}

/** Leads page: check every active watch and show the per-board outcome. */
export function CheckAllJobs() {
  const { pending, run } = useJobCheck();
  const [result, setResult] = useState<JobCheckResult | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending} onClick={() => run({}, setResult)}>
          {pending ? (
            <Loader2Icon
              className="animate-spin motion-reduce:animate-none"
              data-icon="inline-start"
              aria-hidden
            />
          ) : (
            <RefreshCwIcon data-icon="inline-start" aria-hidden />
          )}
          {pending ? "Checking boards…" : "Check for new jobs"}
        </Button>
        <p role="status" aria-live="polite" className="text-muted-foreground text-xs">
          {pending
            ? "Reading every board on your active watches. Large boards can take a minute."
            : "Reads every board on your active watched companies."}
        </p>
      </div>
      {result && !pending ? <CheckSummary result={result} /> : null}
    </div>
  );
}

/** Watchlist row: check one company (active or not) and report in a toast. */
export function CheckWatchButton({
  watchId,
  company,
  companyId,
}: {
  watchId: string;
  company: string;
  companyId: string;
}) {
  const { pending, run, router } = useJobCheck();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Check ${company} for new jobs`}
      onClick={() =>
        run({ watchId }, (result) => {
          const incomplete = result.totals.partial + result.totals.failed;
          const notify = incomplete ? toast.warning : toast.success;
          notify(`${company}: ${summaryLine(result)}`, {
            description:
              result.boards
                .filter((b) => b.reason)
                .map(
                  (b) =>
                    `${b.provider === "OTHER" ? "Careers page" : ATS_PROVIDER_LABELS[b.provider]}: ${REASON_TEXT[b.reason!]}`,
                )
                .join(". ") || undefined,
            action: {
              label: "View leads",
              onClick: () => router.push(`/leads?company=${companyId}`),
            },
          });
        })
      }
    >
      {pending ? "Checking…" : "Check jobs"}
    </Button>
  );
}
