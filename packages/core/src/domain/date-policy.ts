import type { ApplicationStatus } from "./enums";

/** Shared interactive policy; imports never call these functions. Explicit null means blank. */
export function creationDates(
  command: {
    status?: ApplicationStatus;
    dateFound?: string | null;
    appliedAt?: string | null;
  },
  today: string | null,
) {
  return {
    dateFound: command.dateFound === undefined ? today : command.dateFound,
    appliedAt:
      command.appliedAt === undefined
        ? command.status === "APPLIED"
          ? today
          : null
        : command.appliedAt,
  };
}

export function statusAppliedDate(
  command: {
    status: ApplicationStatus;
    appliedAt?: string | null;
  },
  current: { status: ApplicationStatus; appliedAt: string | null },
  today: string | null,
) {
  if (command.appliedAt !== undefined) return command.appliedAt;
  if (command.status === "APPLIED" && current.status !== "APPLIED" && current.appliedAt === null)
    return today;
  return current.appliedAt;
}
