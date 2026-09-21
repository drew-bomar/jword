import { toJwordError, type DuplicateCandidate, type ErrorCode } from "@jword/core/browser";

export interface ActionError {
  code: ErrorCode;
  message: string;
  reason?: string;
  fieldErrors?: Record<string, string[]>;
  candidates?: DuplicateCandidate[];
  currentVersion?: number;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Translate typed errors into a serializable, UI-safe result. Never leaks raw errors. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const typed = toJwordError(error);
    if (typed.code === "INTERNAL_ERROR") {
      console.error(
        JSON.stringify({ level: "error", where: "server-action", message: (error as Error)?.message ?? String(error) }),
      );
    }
    return {
      ok: false,
      error: {
        code: typed.code,
        message: typed.message,
        reason: typed.details.reason,
        fieldErrors: typed.details.fieldErrors,
        candidates: typed.details.candidates,
        currentVersion: typed.details.currentVersion,
      },
    };
  }
}
