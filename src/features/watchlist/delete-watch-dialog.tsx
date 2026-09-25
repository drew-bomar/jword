"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { WatchedCompany } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import { deleteWatchAction } from "@/server/actions/watchlist";

export function DeleteWatchDialog({ watch }: { watch: WatchedCompany }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Confirm the version the owner actually saw, even if the page refreshes behind the dialog.
  const [target, setTarget] = useState(watch);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = pending || unconfirmed;

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await save(
        { watchId: target.watchId, expectedVersion: target.version, confirmed: true },
        deleteWatchAction,
      );
      if (result.ok) {
        toast.success(result.data.replayed ? "Earlier deletion confirmed." : result.data.summary);
        setOpen(false);
        router.refresh();
      } else if (result.error.reason === "STALE_VERSION") {
        setOpen(false);
        toast.error("This watch changed. Review its latest details before deleting it.");
        router.refresh();
      } else if (result.error.code === "NOT_FOUND") {
        setOpen(false);
        toast.info("This watch has already been removed.");
        router.refresh();
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
        if (next) {
          setTarget(watch);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Delete ${watch.company} from watchlist`}
        >
          <Trash2Icon data-icon="inline-start" aria-hidden />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!locked}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete {target.company} from watchlist?</DialogTitle>
          <DialogDescription>
            This removes the watch and its selected boards. Applications, company notes, and history
            are kept. You can add the company to the watchlist again later, but you will need to
            select its boards again.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {unconfirmed ? (
          <p role="status" className="text-sm">
            The deletion may already have completed. Retry to confirm it before closing.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
            {pending ? "Deleting…" : unconfirmed ? "Retry deletion" : "Delete from watchlist"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
