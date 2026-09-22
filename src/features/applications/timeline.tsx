import {
  ACTIVITY_TYPE_LABELS,
  ACTOR_LABELS,
  STATUS_LABELS,
  isApplicationStatus,
  type ApplicationActivity,
} from "@jword/core/browser";
import { formatDateTime } from "@/lib/format";

function describe(value: unknown): string {
  if (value === null || value === undefined || value === "") return "blank";
  if (isApplicationStatus(value)) return STATUS_LABELS[value];
  return String(value);
}

/** Read-only activity history; generated automatically by the mutation functions. */
export function Timeline({ items, hasMore }: { items: ApplicationActivity[]; hasMore: boolean }) {
  return (
    <section aria-labelledby="timeline-heading" className="space-y-3">
      <h2 id="timeline-heading" className="text-sm font-semibold">
        Activity
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity recorded.</p>
      ) : (
        <ol className="relative space-y-4 border-l pl-4">
          {items.map((item) => {
            const fields = Array.isArray(item.metadata.fields)
              ? (item.metadata.fields as string[])
              : [];
            const before = (item.metadata.before ?? {}) as Record<string, unknown>;
            const after = (item.metadata.after ?? {}) as Record<string, unknown>;
            const showDiff = fields.filter((f) => f !== "note" && f !== "description");
            return (
              <li key={item.activityId} className="relative" data-testid="activity">
                <span
                  className="border-background bg-foreground/60 absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2"
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{ACTIVITY_TYPE_LABELS[item.type]}</span>
                    <span className="text-muted-foreground"> · {ACTOR_LABELS[item.actorType]}</span>
                  </p>
                  <time
                    dateTime={item.occurredAt}
                    className="text-muted-foreground text-xs tabular-nums"
                  >
                    {formatDateTime(item.occurredAt)}
                  </time>
                </div>
                <p className="text-muted-foreground text-sm">{item.summary}</p>
                {showDiff.length ? (
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                    {showDiff.map((field) => (
                      <li key={field}>
                        <span className="text-foreground/80 font-medium">{field}</span>:{" "}
                        {describe(before[field])} → {describe(after[field])}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {hasMore ? (
        <p className="text-muted-foreground text-xs">More activity is available below.</p>
      ) : null}
    </section>
  );
}
