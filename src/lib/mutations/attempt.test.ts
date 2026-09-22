import { describe, expect, it } from "vitest";
import { createMutationAttempt } from "./attempt";

describe("unconfirmed saves", () => {
  it("retries the exact committed command after a lost response, despite changed view/input", async () => {
    const attempt = createMutationAttempt();
    const receipts = new Map<string, unknown>();
    const calls: Record<string, unknown>[] = [];
    let loseResponse = true;
    async function perform(command: Record<string, unknown>) {
      calls.push(command);
      receipts.set(command.requestId as string, command);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("response lost after commit");
      }
      return { ok: true as const, data: command };
    }
    const first = await attempt.run({ expectedVersion: 1, note: "original" }, perform);
    expect(first.ok).toBe(false);
    expect(attempt.unresolved).toBe(true);
    await attempt.run({ expectedVersion: 2, note: "edited draft" }, perform);
    expect(calls[1]).toEqual(calls[0]);
    expect(receipts.size).toBe(1);
    expect(attempt.unresolved).toBe(false);
    await attempt.run({ expectedVersion: 2, note: "new operation" }, perform);
    expect(calls[2]!.requestId).not.toBe(calls[0]!.requestId);
  });

  it("keeps the request for an unknown server outcome; starts fresh after a confirmed conflict", async () => {
    const attempt = createMutationAttempt();
    const calls: Record<string, unknown>[] = [];
    await attempt.run({ rows: [{ title: "one" }] }, async (command) => {
      calls.push(command);
      return { ok: false, error: { code: "OUTCOME_UNKNOWN", message: "unconfirmed" } };
    });
    await attempt.run({ rows: [{ title: "two" }] }, async (command) => {
      calls.push(command);
      return {
        ok: false,
        error: { code: "CONFLICT", reason: "STALE_VERSION", message: "refresh" },
      };
    });
    expect(calls[1]).toEqual(calls[0]);
    expect(attempt.unresolved).toBe(false);
    await attempt.run({ rows: [{ title: "two" }] }, async (command) => {
      expect(command.requestId).not.toBe(calls[0]!.requestId);
      return { ok: true, data: null };
    });
  });
});
