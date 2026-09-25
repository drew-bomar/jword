"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ATS_PROVIDER_LABELS,
  type BoardDiscoveryResult,
  type CompanyOption,
  type InferredBoard,
} from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import type { ActionError } from "@/server/actions/result";
import type { WatchCaptureApi } from "./watch-api";

/** Explicitly saves the current board through the same audited service as the watchlist. */
export function WatchCaptureReview({
  company: initialCompany,
  board,
  api,
  jwordUrl,
  onBusyChange,
}: {
  company: string;
  board: InferredBoard;
  api: WatchCaptureApi;
  jwordUrl: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const [company, setCompany] = useState(initialCompany);
  const [chosen, setChosen] = useState<CompanyOption | null>(null);
  const [matches, setMatches] = useState<CompanyOption[]>([]);
  const [check, setCheck] = useState<{ key: string; result: BoardDiscoveryResult } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<ActionError | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirmUnverified, setConfirmUnverified] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const locked = pending || unconfirmed;
  const name = company.trim();
  const key = JSON.stringify([name, chosen?.companyId, board.boardUrl]);

  useEffect(() => {
    onBusyChange(locked);
  }, [locked, onBusyChange]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!name) return;
      const identity = chosen ? { companyId: chosen.companyId } : { company: name };
      try {
        const [verified, found] = await Promise.all([
          api.verifyBoards({ ...identity, boardUrls: [board.boardUrl] }),
          api.searchCompanies({ text: name }),
        ]);
        if (cancelled) return;
        if (verified.ok && found.ok) {
          setCheck({ key, result: verified.data });
          setMatches(found.data);
          setReadError(null);
        } else {
          setReadError(
            !verified.ok ? verified.error.message : !found.ok ? found.error.message : null,
          );
        }
      } catch {
        if (!cancelled)
          setReadError("Could not check this board. Check your connection and retry.");
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, name, chosen, board.boardUrl, key, retry]);

  const result = check?.key === key ? check.result : null;
  const suggestion = result?.suggestions[0];
  const existing = chosen?.watchId
    ? chosen
    : matches.find((item) => item.companyId === result?.companyId && item.watchId);
  const occupied = existing || suggestion?.watchedBy;
  const unverified = suggestion?.verification !== "found" || !result?.ownershipChecked;

  function changeCompany(value: string, selection: CompanyOption | null = null) {
    setCompany(value);
    setChosen(selection);
    setMatches([]);
    setCheck(null);
    setReadError(null);
    setSaveError(null);
    setConfirmUnverified(false);
  }

  function submit() {
    startTransition(async () => {
      const saved = await save(
        {
          ...(chosen ? { companyId: chosen.companyId } : { company: name }),
          boards: [{ provider: board.provider, boardIdentifier: board.boardIdentifier }],
        },
        api.addWatch,
      );
      if (saved.ok) {
        setDone(saved.data.company);
        setSaveError(null);
      } else setSaveError(saved.error);
    });
  }

  if (done)
    return (
      <div role="status" className="space-y-3">
        <p>{done} added to your watchlist.</p>
        <a href={`${jwordUrl}/watchlist`} target="_blank" rel="noopener" className="underline">
          Open watchlist
        </a>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Watch this board without adding a job application. Confirm the company before saving.
      </p>
      <p className="text-sm break-all">
        {ATS_PROVIDER_LABELS[board.provider]}:{" "}
        <a href={board.boardUrl} target="_blank" rel="noopener" className="underline">
          {board.boardIdentifier}
        </a>
      </p>
      <div className="space-y-2">
        <Label htmlFor="capture-watch-company">Company to watch</Label>
        <Input
          id="capture-watch-company"
          value={company}
          maxLength={200}
          disabled={locked}
          onChange={(event) => changeCompany(event.target.value)}
        />
        {matches.length && !chosen ? (
          <div className="space-y-1" aria-label="Existing companies">
            <p className="text-muted-foreground text-xs">Use an existing company if it matches:</p>
            {matches.map((item) => (
              <Button
                key={item.companyId}
                type="button"
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => changeCompany(item.name, item)}
              >
                {item.name}
                {item.watchId ? " (already watched)" : ""}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {readError ? (
        <div role="alert" className="space-y-2">
          <p>{readError}</p>
          <Button
            type="button"
            disabled={locked}
            onClick={() => {
              setReadError(null);
              setRetry((n) => n + 1);
            }}
          >
            Retry check
          </Button>
          <a href={jwordUrl} target="_blank" rel="noopener" className="block underline">
            Open jword to sign in
          </a>
        </div>
      ) : !result && name ? (
        <p role="status">Checking board…</p>
      ) : null}
      {suggestion ? (
        <div className="space-y-2 text-sm">
          <p>{suggestion.reasons.join(". ")}</p>
          {suggestion.openJobs !== null ? (
            <p>
              {suggestion.openJobs}
              {suggestion.openJobsAtLeast ? "+" : ""} open jobs
            </p>
          ) : null}
          {result?.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {unverified && !occupied ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={confirmUnverified}
                disabled={locked}
                onChange={(event) => setConfirmUnverified(event.target.checked)}
              />
              Save this board even though its availability or ownership could not be verified.
            </label>
          ) : null}
        </div>
      ) : null}
      {occupied ? (
        <p role="status">This company or board is already watched. Manage it in your watchlist.</p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-destructive">
          {saveError.message}
        </p>
      ) : null}
      {unconfirmed ? <p>The save may have completed. Retry to confirm it before closing.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={
            pending ||
            (!unconfirmed &&
              (!name ||
                !suggestion ||
                !!readError ||
                !!occupied ||
                (unverified && !confirmUnverified)))
          }
          onClick={submit}
        >
          {pending ? "Saving…" : unconfirmed ? "Retry watch save" : "Add to watchlist"}
        </Button>
        <a
          href={`${jwordUrl}/watchlist`}
          target="_blank"
          rel="noopener"
          className="text-sm underline"
        >
          Open watchlist
        </a>
      </div>
    </div>
  );
}
