"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ApplicationPriority,
  type ApplicationStatus,
} from "@jword/core/browser";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { updateDetailsAction, updateStatusAction } from "@/server/actions/applications";
import { cn } from "@/lib/utils";
import { PriorityBadge, StatusBadge } from "./badges";
import type { ActionResult } from "@/server/actions/result";

function useInlineMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(perform: () => Promise<ActionResult<{ summary: string; noop: boolean }>>) {
    startTransition(async () => {
      const result = await perform();
      if (result.ok) {
        if (!result.data.noop) toast.success(result.data.summary);
        router.refresh();
        return;
      }
      if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
        toast.error("This application changed since you opened it. Refreshing the latest values.");
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
  return { pending, run };
}

const triggerClass =
  "h-auto w-auto border-transparent bg-transparent px-0.5 py-0.5 shadow-none hover:border-border data-[state=open]:border-border";

export function InlineStatusSelect({
  applicationId,
  version,
  status,
  label,
}: {
  applicationId: string;
  version: number;
  status: ApplicationStatus;
  label: string;
}) {
  const { pending, run } = useInlineMutation();
  const [open, setOpen] = useState(false);
  return (
    <Select
      value={status}
      open={open}
      onOpenChange={setOpen}
      disabled={pending}
      onValueChange={(next) => {
        if (next === status) return;
        run(() =>
          updateStatusAction({
            requestId: crypto.randomUUID(),
            applicationId,
            expectedVersion: version,
            status: next as ApplicationStatus,
          }),
        );
      }}
    >
      <SelectTrigger aria-label={`Status for ${label}: ${STATUS_LABELS[status]}`} className={cn(triggerClass, pending && "opacity-60")} size="sm">
        <StatusBadge status={status} />
      </SelectTrigger>
      <SelectContent>
        {APPLICATION_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InlinePrioritySelect({
  applicationId,
  version,
  priority,
  label,
}: {
  applicationId: string;
  version: number;
  priority: ApplicationPriority;
  label: string;
}) {
  const { pending, run } = useInlineMutation();
  return (
    <Select
      value={priority}
      disabled={pending}
      onValueChange={(next) => {
        if (next === priority) return;
        run(() =>
          updateDetailsAction({
            requestId: crypto.randomUUID(),
            applicationId,
            expectedVersion: version,
            priority: next as ApplicationPriority,
          }),
        );
      }}
    >
      <SelectTrigger aria-label={`Priority for ${label}: ${PRIORITY_LABELS[priority]}`} className={cn(triggerClass, pending && "opacity-60")} size="sm">
        <PriorityBadge priority={priority} />
      </SelectTrigger>
      <SelectContent>
        {APPLICATION_PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
