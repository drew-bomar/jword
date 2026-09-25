import { boardKey } from "../watchlist/schemas";
import { untilAborted } from "./cancellation";
import type { BoardDirectory, ProbeOutcome } from "./types";

interface Entry {
  controller: AbortController;
  promise: Promise<ProbeOutcome>;
  subscribers: number;
}

/** Public provider evidence only. Owner data and complete discovery results are never cached. */
export function createCachedBoardDirectory(
  directory: BoardDirectory,
  options: {
    ttlMs?: number;
    maxEntries?: number;
    concurrency?: number;
    maxQueue?: number;
  } = {},
): BoardDirectory {
  const ttl = options.ttlMs ?? 300_000;
  const capacity = options.maxEntries ?? 256;
  const concurrency = options.concurrency ?? 6;
  const maxQueue = options.maxQueue ?? 30;
  const cache = new Map<string, { result: ProbeOutcome; expires: number }>();
  const inflight = new Map<string, Entry>();
  const queue: Array<() => void> = [];
  let active = 0;

  function schedule(run: () => Promise<ProbeOutcome>, signal: AbortSignal): Promise<ProbeOutcome> {
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancelQueued);
        active++;
        untilAborted(
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return run();
          }),
          signal,
        )
          .then(resolve, reject)
          .finally(() => {
            active--;
            // Reserve the released slot synchronously before a new caller can take it.
            queue.shift()?.();
          });
      };
      const cancelQueued = () => {
        const index = queue.indexOf(start);
        if (index !== -1) queue.splice(index, 1);
        resolve({ status: "error" });
      };
      if (signal.aborted || (active >= concurrency && queue.length >= maxQueue)) {
        resolve({ status: "error" });
      } else if (active < concurrency) start();
      else {
        queue.push(start);
        signal.addEventListener("abort", cancelQueued, { once: true });
      }
    });
  }

  return {
    async probe(provider, identifier, signal) {
      if (signal?.aborted) return { status: "error" };
      const key = boardKey({ provider, boardIdentifier: identifier });
      const saved = cache.get(key);
      if (saved && saved.expires > Date.now()) return saved.result;
      cache.delete(key);
      let entry = inflight.get(key);
      if (!entry) {
        const controller = new AbortController();
        const created: Entry = {
          controller,
          subscribers: 0,
          promise: Promise.resolve({ status: "error" }),
        };
        entry = created;
        inflight.set(key, created);
        created.promise = schedule(
          () => directory.probe(provider, identifier, controller.signal),
          controller.signal,
        )
          .catch((): ProbeOutcome => ({ status: "error" }))
          .then((result) => {
            if (!controller.signal.aborted) {
              if (cache.size >= capacity) cache.delete(cache.keys().next().value!);
              cache.set(key, {
                result,
                expires: Date.now() + (result.status === "error" ? Math.min(ttl, 5_000) : ttl),
              });
            }
            return result;
          })
          .finally(() => {
            if (inflight.get(key) === created) inflight.delete(key);
          });
      }
      entry.subscribers++;
      try {
        return await (signal ? untilAborted(entry.promise, signal) : entry.promise);
      } catch {
        return { status: "error" };
      } finally {
        entry.subscribers--;
        if (entry.subscribers === 0 && inflight.get(key) === entry) {
          inflight.delete(key);
          entry.controller.abort();
        }
      }
    },
  };
}
