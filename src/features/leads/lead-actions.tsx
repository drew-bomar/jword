"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  STATUS_LABELS,
  type ApplicationStatus,
  type DuplicateCandidate,
  type Lead,
} from "@jword/core/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import { createApplicationFromLeadAction, setLeadReviewStatusAction } from "@/server/actions/leads";

/** Dismiss a new lead or restore a dismissed one. Keeps the request ID until confirmed. */
function ReviewButton({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const dismissing = lead.reviewStatus === "NEW";

  function run() {
    startTransition(async () => {
      const result = await save(
        {
          leadId: lead.leadId,
          expectedVersion: lead.version,
          reviewStatus: dismissing ? "DISMISSED" : "NEW",
        },
        setLeadReviewStatusAction,
      );
      if (result.ok) {
        toast.success(result.data.replayed ? "Earlier change confirmed." : result.data.summary);
        router.refresh();
      } else if (
        result.error.reason === "STALE_VERSION" ||
        result.error.reason === "LEAD_PROMOTED"
      ) {
        toast.error("This lead changed since you opened it. Showing the latest values.");
        router.refresh();
      } else if (result.error.code === "UNAUTHENTICATED") {
        router.push("/sign-in");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={run}
      aria-label={`${unconfirmed ? "Retry" : dismissing ? "Dismiss" : "Restore"} ${lead.title}`}
    >
      {pending ? "Saving…" : unconfirmed ? "Retry save" : dismissing ? "Dismiss" : "Restore"}
    </Button>
  );
}

/**
 * Create a SAVED application from the lead. A possible duplicate is shown and needs explicit
 * confirmation; an unconfirmed save keeps its request ID so a retry cannot create two.
 */
function CreateApplicationDialog({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const locked = pending || unconfirmed;

  function create(allowDuplicate = false) {
    setError(null);
    startTransition(async () => {
      const result = await save(
        {
          leadId: lead.leadId,
          expectedVersion: lead.version,
          ...(allowDuplicate ? { allowDuplicate: true } : {}),
        },
        createApplicationFromLeadAction,
      );
      if (result.ok) {
        setOpen(false);
        setCandidates(null);
        toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary, {
          action: result.data.applicationId
            ? {
                label: "Open",
                onClick: () => router.push(`/applications/${result.data.applicationId}`),
              }
            : undefined,
        });
        router.refresh();
      } else if (result.error.reason === "DUPLICATE_CANDIDATES") {
        setCandidates(result.error.candidates ?? []);
      } else if (
        result.error.reason === "STALE_VERSION" ||
        result.error.reason === "LEAD_PROMOTED"
      ) {
        setOpen(false);
        toast.error("This lead changed since you opened it. Showing the latest values.");
        router.refresh();
      } else if (result.error.code === "UNAUTHENTICATED") {
        router.push("/sign-in");
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (locked) return;
        setOpen(next);
        if (!next) {
          setCandidates(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" aria-label={`Create application for ${lead.title}`}>
          Create application
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!locked}>
        <DialogHeader>
          <DialogTitle>Create application</DialogTitle>
          <DialogDescription>
            Saves “{lead.title}” at {lead.company} as a Saved application, with its link, location,
            and description. The lead is marked as Application created.
          </DialogDescription>
        </DialogHeader>
        {candidates ? (
          <Alert role="alert">
            <AlertTitle>Possible duplicate</AlertTitle>
            <AlertDescription>
              <p>Similar applications already exist. Nothing was created.</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {candidates.map((c) => (
                  <li key={c.applicationId}>
                    <Link href={`/applications/${c.applicationId}`} className="underline">
                      {c.company} — {c.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      ({STATUS_LABELS[c.status as ApplicationStatus] ?? c.status})
                    </span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {unconfirmed ? (
          <p role="status" className="text-muted-foreground text-xs">
            The save was not confirmed. Retry sends the same request, so it cannot create a second
            application.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={locked} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {candidates && !unconfirmed ? (
            <Button type="button" disabled={pending} onClick={() => create(true)}>
              Create anyway
            </Button>
          ) : (
            <Button type="button" disabled={pending} onClick={() => create()}>
              {pending ? "Saving…" : unconfirmed ? "Retry save" : "Create application"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadActions({ lead }: { lead: Lead }) {
  if (lead.reviewStatus === "PROMOTED" && lead.applicationId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/applications/${lead.applicationId}`}>View application</Link>
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <CreateApplicationDialog lead={lead} />
      <ReviewButton lead={lead} />
    </div>
  );
}
