"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
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
import { WatchForm } from "./watch-form";

/** Dialogs stay open while a save is pending or unconfirmed, like the tracker's edit dialog. */
function useGuardedDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return {
    open,
    setBusy,
    onOpenChange: (next: boolean) => {
      if (!busy) setOpen(next);
    },
    // The form unmounts on close before it can report "not busy", so reset here.
    saved: () => {
      setBusy(false);
      setOpen(false);
      router.refresh();
    },
    cancel: () => {
      setBusy(false);
      setOpen(false);
    },
  };
}

export function AddWatchDialog() {
  const dialog = useGuardedDialog();
  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" aria-hidden />
          Add company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add to watchlist</DialogTitle>
          <DialogDescription>
            jword looks up the company&apos;s Greenhouse, Lever, and Ashby boards; you pick up to
            three. Job postings are not collected yet, and adding a company never changes its
            applications.
          </DialogDescription>
        </DialogHeader>
        {dialog.open ? (
          <WatchForm
            mode={{ kind: "add" }}
            onBusyChange={dialog.setBusy}
            onSaved={dialog.saved}
            onCancel={dialog.cancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function EditWatchDialog({ watch }: { watch: WatchedCompany }) {
  const dialog = useGuardedDialog();
  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${watch.company}`}>
          <PencilIcon data-icon="inline-start" aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {watch.company}</DialogTitle>
          <DialogDescription>
            Changes are recorded in the watch history. To stop monitoring, use Deactivate.
          </DialogDescription>
        </DialogHeader>
        {dialog.open ? (
          <WatchForm
            key={watch.watchId}
            mode={{ kind: "edit", watch }}
            onBusyChange={dialog.setBusy}
            onSaved={dialog.saved}
            onCancel={dialog.cancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
