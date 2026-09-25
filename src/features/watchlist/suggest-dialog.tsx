"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationWatchSuggestion } from "@jword/core/browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createMutationAttempt } from "@/lib/mutations/attempt";
import { addWatchAction } from "@/server/actions/watchlist";
import { readWatchlist } from "./read";
import { boardLabel } from "./board-picker";

type ItemState =
  { kind: "idle" } | { kind: "saved" } | { kind: "failed"; message: string; retryable: boolean };

/**
 * Bulk start: companies you applied to but do not watch yet, with boards read from the job URLs
 * you saved (no network). Each selected company is added as its own save, so one failure does
 * not undo the others; an unconfirmed save is retried with its original request ID.
 */
export function SuggestFromApplicationsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ApplicationWatchSuggestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [pending, startTransition] = useTransition();
  const loadingRequest = useRef<AbortController | null>(null);
  useEffect(() => () => loadingRequest.current?.abort(), []);
  const attempts = useRef(new Map<string, ReturnType<typeof createMutationAttempt>>());

  async function load() {
    loadingRequest.current?.abort();
    const controller = new AbortController();
    loadingRequest.current = controller;
    setLoading(true);
    setLoadError(null);
    const result = await readWatchlist<ApplicationWatchSuggestion[]>(
      "suggestions",
      {},
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    setSuggestions(result.data);
    setChosen(new Set(result.data.map((s) => s.companyId)));
    setStates({});
    attempts.current.clear();
  }

  function watchSelected() {
    const targets = (suggestions ?? []).filter(
      (s) => chosen.has(s.companyId) && states[s.companyId]?.kind !== "saved",
    );
    startTransition(async () => {
      let saved = 0;
      for (const item of targets) {
        const attempt = attempts.current.get(item.companyId) ?? createMutationAttempt();
        attempts.current.set(item.companyId, attempt);
        const result = await attempt.run(
          {
            companyId: item.companyId,
            company: item.company,
            boards: item.boards.map((b) => ({
              provider: b.provider,
              boardIdentifier: b.boardIdentifier,
            })),
          },
          addWatchAction,
        );
        const next: ItemState = result.ok
          ? { kind: "saved" }
          : {
              kind: "failed",
              message: result.error.message,
              retryable: attempt.unresolved,
            };
        if (result.ok) saved += 1;
        setStates((s) => ({ ...s, [item.companyId]: next }));
      }
      if (saved) {
        toast.success(`Now watching ${saved} ${saved === 1 ? "company" : "companies"}.`);
        router.refresh();
      }
    });
  }

  const remaining = (suggestions ?? []).filter(
    (s) => chosen.has(s.companyId) && states[s.companyId]?.kind !== "saved",
  ).length;
  const anyUnconfirmed = Object.values(states).some((s) => s.kind === "failed" && s.retryable);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending || anyUnconfirmed) return;
        if (!next) loadingRequest.current?.abort();
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <SparklesIcon data-icon="inline-start" aria-hidden />
          Suggest from applications
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suggest from applications</DialogTitle>
          <DialogDescription>
            Companies you applied to but do not watch yet, with the job boards their saved links
            point to. Nothing is fetched; pick the ones to watch.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p role="status" className="text-muted-foreground text-sm">
            Reading your applications…
          </p>
        ) : loadError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{loadError}</AlertDescription>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </Alert>
        ) : suggestions && suggestions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No suggestions. Either every company you applied to is already watched, or their saved
            job links are not on Greenhouse, Lever, Ashby, or Workday. Use Add company to look them
            up.
          </p>
        ) : suggestions ? (
          <div className="space-y-4">
            <ul className="space-y-2" aria-label="Suggested companies">
              {suggestions.map((item) => {
                const state = states[item.companyId] ?? { kind: "idle" };
                const id = `suggest-${item.companyId}`;
                return (
                  <li
                    key={item.companyId}
                    className="flex gap-3 rounded-md border p-2.5"
                    data-testid="application-suggestion"
                  >
                    {state.kind === "saved" ? (
                      <CheckIcon className="mt-0.5 size-4 text-emerald-600" aria-label="Watching" />
                    ) : (
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={chosen.has(item.companyId)}
                        disabled={pending || (state.kind === "failed" && state.retryable)}
                        onCheckedChange={(v) =>
                          setChosen((set) => {
                            const next = new Set(set);
                            if (v === true) next.add(item.companyId);
                            else next.delete(item.companyId);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={id} className="font-medium">
                        {item.company}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {item.boards.map(boardLabel).join(", ")} · {item.applicationCount}{" "}
                        application{item.applicationCount === 1 ? "" : "s"}
                        {state.kind === "saved" ? " · Watching" : ""}
                      </p>
                      {state.kind === "failed" ? (
                        <p className="text-destructive text-xs" role="alert">
                          {state.message}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending || remaining === 0} onClick={watchSelected}>
                {pending
                  ? "Saving…"
                  : anyUnconfirmed
                    ? "Retry unconfirmed saves"
                    : `Watch ${remaining} ${remaining === 1 ? "company" : "companies"}`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending || anyUnconfirmed}
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
