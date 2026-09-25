"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import { setWatchStatusAction } from "@/server/actions/watchlist";

/**
 * Deactivate (pause monitoring) or reactivate. Deactivation only flips the watch's
 * active flag; the company, its applications, and all history stay. An unconfirmed save keeps
 * its original command and request ID until "Retry save" resolves it.
 */
export function WatchStatusButton({
  watchId,
  version,
  active,
  company,
}: {
  watchId: string;
  version: number;
  active: boolean;
  company: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();

  function run() {
    startTransition(async () => {
      const result = await save(
        { watchId, expectedVersion: version, active: !active },
        setWatchStatusAction,
      );
      if (result.ok) {
        toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary);
        router.refresh();
        return;
      }
      if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
        toast.error("This watch changed since you opened it. Showing the latest values.");
        router.refresh();
        return;
      }
      if (result.error.code === "UNAUTHENTICATED") {
        router.push("/sign-in");
        return;
      }
      toast.error(result.error.message);
    });
  }

  if (unconfirmed) {
    return (
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
        {pending ? "Retrying…" : "Retry save"}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={run}
      aria-label={`${active ? "Deactivate" : "Reactivate"} ${company}`}
    >
      {pending ? "Saving…" : active ? "Deactivate" : "Reactivate"}
    </Button>
  );
}
