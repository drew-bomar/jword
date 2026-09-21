import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BookmarkIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClipboardCheckIcon,
  FlagIcon,
  MessageSquareIcon,
  SearchIcon,
  SendIcon,
  UndoIcon,
  XCircleIcon,
} from "lucide-react";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ApplicationPriority,
  type ApplicationStatus,
} from "@jword/core/browser";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ApplicationStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  SAVED: { icon: BookmarkIcon, className: "bg-muted text-foreground/80" },
  RESEARCHING: { icon: SearchIcon, className: "bg-muted text-foreground/80" },
  READY_TO_APPLY: { icon: CircleDashedIcon, className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  APPLIED: { icon: SendIcon, className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  OA: { icon: ClipboardCheckIcon, className: "bg-indigo-500/15 text-indigo-800 dark:text-indigo-300" },
  INTERVIEW: { icon: MessageSquareIcon, className: "bg-violet-500/15 text-violet-800 dark:text-violet-300" },
  FINAL: { icon: FlagIcon, className: "bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-300" },
  OFFER: { icon: CheckCircle2Icon, className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  REJECTED: { icon: XCircleIcon, className: "bg-red-500/15 text-red-800 dark:text-red-300" },
  WITHDRAWN: { icon: UndoIcon, className: "bg-muted text-muted-foreground" },
};

const PRIORITY_STYLE: Record<ApplicationPriority, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  LOW: { icon: ArrowDownIcon, className: "text-muted-foreground" },
  MEDIUM: { icon: ArrowRightIcon, className: "text-foreground/80" },
  HIGH: { icon: ArrowUpIcon, className: "text-orange-700 dark:text-orange-300" },
};

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        style.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: ApplicationPriority; className?: string }) {
  const style = PRIORITY_STYLE[priority];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", style.className, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
