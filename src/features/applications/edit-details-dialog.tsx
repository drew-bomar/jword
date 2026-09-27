"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import type { ApplicationDetail } from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApplicationForm } from "./application-form";
import { DeleteApplication } from "./delete-application";

export function EditDetailsDialog({ application }: { application: ApplicationDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const busy = editBusy || deleteBusy;
  // Reopening before the refreshed application arrives would show the pre-save values.
  const [refreshing, startRefresh] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={refreshing}>
          <PencilIcon data-icon="inline-start" aria-hidden />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Changes are recorded in the activity timeline. Status is changed from the header.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <>
            <fieldset disabled={deleteBusy} className="contents">
              <ApplicationForm
                key={application.applicationId}
                onBusyChange={setEditBusy}
                mode={{
                  kind: "edit",
                  application,
                  onSaved: () => {
                    setEditBusy(false);
                    setOpen(false);
                    startRefresh(() => router.refresh());
                  },
                  onCancel: () => {
                    setEditBusy(false);
                    setOpen(false);
                  },
                }}
              />
            </fieldset>
            <fieldset disabled={editBusy} className="contents">
              <DeleteApplication application={application} onBusyChange={setDeleteBusy} />
            </fieldset>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
