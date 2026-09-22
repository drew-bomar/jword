import type { ActionResult } from "../../server/actions/result";

export const UNCONFIRMED_MESSAGE =
  "The save result is unconfirmed. It may already have been saved. Retry the original save before making another change.";

/** Retain the exact command until its result is known, even if the view refreshes. */
export function createMutationAttempt() {
  let command: Record<string, unknown> | null = null;
  return {
    async run<T>(
      input: Record<string, unknown>,
      perform: (command: Record<string, unknown>) => Promise<ActionResult<T>>,
    ): Promise<ActionResult<T>> {
      command ??= { ...structuredClone(input), requestId: crypto.randomUUID() };
      let result: ActionResult<T>;
      try {
        result = await perform(structuredClone(command));
      } catch {
        result = { ok: false, error: { code: "OUTCOME_UNKNOWN", message: UNCONFIRMED_MESSAGE } };
      }
      if (result.ok || !["OUTCOME_UNKNOWN", "INTERNAL_ERROR"].includes(result.error.code)) {
        command = null;
      }
      return result;
    },
    get unresolved() {
      return command !== null;
    },
  };
}
