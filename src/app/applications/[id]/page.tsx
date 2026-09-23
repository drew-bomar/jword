import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { JwordError, WORK_ARRANGEMENT_LABELS, isIsoDate } from "@jword/core/browser";
import { PageNavigation } from "@/components/page-navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/features/applications/badges";
import { EditDetailsDialog } from "@/features/applications/edit-details-dialog";
import { InlinePrioritySelect, InlineStatusSelect } from "@/features/applications/inline-selects";
import { NotesSection } from "@/features/applications/notes-section";
import { Timeline } from "@/features/applications/timeline";
import { formatDate, formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Application" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: PageProps<"/applications/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const notesCursor = typeof query.notesCursor === "string" ? query.notesCursor : undefined;
  const activityCursor =
    typeof query.activityCursor === "string" ? query.activityCursor : undefined;
  if (!UUID.test(id)) notFound();
  const session = await requirePageSession();
  const services = servicesFor(session);

  let view;
  try {
    view = await services.getApplication(
      { applicationId: id, notesLimit: 50, activityLimit: 50, notesCursor, activityCursor },
      session.actor,
    );
  } catch (error) {
    if (error instanceof JwordError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { application, notes, activity } = view;
  const label = `${application.company} ${application.title}`;

  const facts: Array<[string, React.ReactNode]> = [
    ["Location", application.location ?? "—"],
    ["Work arrangement", WORK_ARRANGEMENT_LABELS[application.workArrangement]],
    ["Date found", formatDate(application.dateFound)],
    ["Date applied", formatDate(application.appliedAt)],
    ["Date posted", formatDate(application.datePosted)],
    ["Source", application.source ?? "—"],
    ["External job ID", application.externalJobId ?? "—"],
    ["Resume version", application.resumeVersion ?? "—"],
    ["Referral", application.referral ?? "—"],
    ["Last activity", formatDateTime(application.lastActivityAt)],
  ];

  return (
    <AppShell email={session.email}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <Link href="/">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              Applications
            </Link>
          </Button>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-muted-foreground text-sm">{application.company}</p>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              <span>{application.title}</span>
              {application.jobUrl ? (
                <a
                  href={application.jobUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-normal"
                >
                  Posting
                  <ExternalLinkIcon className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </h1>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <InlineStatusSelect
                applicationId={application.applicationId}
                version={application.version}
                status={application.status}
                label={label}
              />
              <InlinePrioritySelect
                applicationId={application.applicationId}
                version={application.version}
                priority={application.priority}
                label={label}
              />
              <span className="sr-only">
                Current status <StatusBadge status={application.status} />
              </span>
            </div>
          </div>
          <EditDetailsDialog application={application} />
        </header>

        <section aria-labelledby="details-heading" className="rounded-lg border">
          <h2 id="details-heading" className="sr-only">
            Details
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([term, value]) => (
              <div key={term} className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">{term}</dt>
                <dd className={isIsoDate(String(value)) ? "tabular-nums" : ""}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {application.description ? (
          <details className="rounded-lg border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Job description</summary>
            <p className="text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap">
              {application.description}
            </p>
          </details>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-3">
            <NotesSection
              applicationId={application.applicationId}
              version={application.version}
              notes={notes.items}
              hasMore={notes.hasMore}
            />
            <PageNavigation
              pathname={`/applications/${id}`}
              params={query}
              cursorKey="notesCursor"
              current={notesCursor}
              next={notes.nextCursor}
              label="Notes"
            />
          </div>
          <div className="space-y-3">
            <Separator className="lg:hidden" />
            <Timeline items={activity.items} hasMore={activity.hasMore} />
            <PageNavigation
              pathname={`/applications/${id}`}
              params={query}
              cursorKey="activityCursor"
              current={activityCursor}
              next={activity.nextCursor}
              label="Activity"
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
