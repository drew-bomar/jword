"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationDetail } from "@jword/core/browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import { deleteApplicationAction } from "@/server/actions/applications";

/**
 * Permanent deletion inside Edit details (decision 025). A second, explicit step names the
 * application; an unconfirmed attempt keeps its request ID so Retry cannot delete twice, and the
 * dialog stays open until the outcome is known.
 */
export function DeleteApplication({
  application,
  onBusyChange,
}: {
  application: ApplicationDetail;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  useEffect(() => {
    onBusyChange(pending || unconfirmed);
  }, [pending, unconfirmed, onBusyChange]);

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await save(
        {
          applicationId: application.applicationId,
          expectedVersion: application.version,
          confirmed: true,
        },
        deleteApplicationAction,
      );
      if (result.ok) {
        toast.success(result.data.replayed ? "Earlier deletion confirmed." : result.data.summary);
        router.push("/");
        return;
      }
      if (result.error.code === "UNAUTHENTICATED") {
        router.push("/sign-in");
        return;
      }
      if (result.error.reason === "STALE_VERSION") {
        setConfirming(false);
        toast.error("This application changed since you opened it. Review it before deleting.");
        router.refresh();
        return;
      }
      if (result.error.code === "NOT_FOUND") {
        toast.info("This application was already deleted.");
        router.push("/");
        return;
      }
      setError(result.error.message);
    });
  }

  const locked = pending || unconfirmed;
  return (
    <section
      aria-labelledby="delete-application-heading"
      className="border-destructive/30 space-y-2 rounded-lg border p-3"
    >
      <h3 id="delete-application-heading" className="text-sm font-medium">
        Delete application
      </h3>
      {confirming ? (
        <>
          <p className="text-sm">
            Permanently delete <span className="font-medium">{application.title}</span> at{" "}
            {application.company}? Its notes and activity history are removed too. The company
            stays. This cannot be undone.
          </p>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {unconfirmed ? (
            <p role="status" className="text-muted-foreground text-xs">
              The deletion was not confirmed. Retry sends the same request.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={() => setConfirming(false)}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={remove}
            >
              {pending ? "Deleting…" : unconfirmed ? "Retry delete" : "Delete permanently"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Removes this application, its notes, and its history. A lead it came from returns to
            New.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <Trash2Icon data-icon="inline-start" aria-hidden />
            Delete application
          </Button>
        </div>
      )}
    </section>
  );
}
