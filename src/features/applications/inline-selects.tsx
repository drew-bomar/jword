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
import { Button } from "@/components/ui/button";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import type { ActionResult } from "@/server/actions/result";

function useInlineMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { save, unconfirmed } = useReliableMutation();
  const [retry, setRetry] = useState<((version?: number) => void) | null>(null);
  const [stale, setStale] = useState(false);
  const [requested, setRequested] = useState("");
  function run(
    command: Record<string, unknown>,
    perform: (
      input: unknown,
    ) => Promise<ActionResult<{ summary: string; noop: boolean; replayed?: boolean }>>,
  ) {
    setRetry(
      () => (version?: number) =>
        run({ ...command, ...(version ? { expectedVersion: version } : {}) }, perform),
    );
    setRequested(String(command.status ?? command.priority));
    setStale(false);
    startTransition(async () => {
      const result = await save(command, perform);
      if (result.ok) {
        if (!result.data.noop)
          toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary);
        router.refresh();
        return;
      }
      if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
        setStale(true);
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
  return { pending, run, unconfirmed, retry, stale, requested };
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
  const { pending, run, unconfirmed, retry, stale, requested } = useInlineMutation();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Select
        value={status}
        open={open}
        onOpenChange={setOpen}
        disabled={pending || unconfirmed}
        onValueChange={(next) => {
          if (next === status) return;
          run(
            {
              applicationId,
              expectedVersion: version,
              status: next as ApplicationStatus,
            },
            updateStatusAction,
          );
        }}
      >
        <SelectTrigger
          aria-label={`Status for ${label}: ${STATUS_LABELS[status]}`}
          className={cn(triggerClass, pending && "opacity-60")}
          size="sm"
        >
          <StatusBadge status={status} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {APPLICATION_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unconfirmed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => retry?.()}
        >
          Retry save
        </Button>
      ) : null}
      {stale ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => retry?.(version)}
        >
          Reapply {requested.toLowerCase().replaceAll("_", " ")}
        </Button>
      ) : null}
    </span>
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
  const { pending, run, unconfirmed, retry, stale, requested } = useInlineMutation();
  return (
    <span className="inline-flex items-center gap-1">
      <Select
        value={priority}
        disabled={pending || unconfirmed}
        onValueChange={(next) => {
          if (next === priority) return;
          run(
            {
              applicationId,
              expectedVersion: version,
              priority: next as ApplicationPriority,
            },
            updateDetailsAction,
          );
        }}
      >
        <SelectTrigger
          aria-label={`Priority for ${label}: ${PRIORITY_LABELS[priority]}`}
          className={cn(triggerClass, pending && "opacity-60")}
          size="sm"
        >
          <PriorityBadge priority={priority} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {APPLICATION_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unconfirmed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => retry?.()}
        >
          Retry save
        </Button>
      ) : null}
      {stale ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => retry?.(version)}
        >
          Reapply {requested.toLowerCase().replaceAll("_", " ")}
        </Button>
      ) : null}
    </span>
  );
}
