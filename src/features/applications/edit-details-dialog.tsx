"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

export function EditDetailsDialog({ application }: { application: ApplicationDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
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
          <ApplicationForm
            key={application.applicationId}
            onBusyChange={setBusy}
            mode={{
              kind: "edit",
              application,
              onSaved: () => {
                setOpen(false);
                router.refresh();
              },
              onCancel: () => setOpen(false),
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
