"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import {
  ATS_PROVIDER_LABELS,
  boardKey,
  inferBoardFromUrl,
  MAX_BOARDS_PER_WATCH,
  type BoardConfidence,
  type BoardDiscoveryResult,
  type BoardSuggestion,
  type WatchBoard,
} from "@jword/core/browser";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { readWatchlist } from "./read";

const CONFIDENCE_LABELS: Record<BoardConfidence, string> = {
  high: "Strong match",
  medium: "Possible match",
  low: "Unlikely match",
};
const CONFIDENCE_STYLE: Record<BoardConfidence, string> = {
  high: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

export function boardLabel(board: WatchBoard): string {
  return board.provider === "OTHER"
    ? `Careers page ${board.boardUrl}`
    : `${ATS_PROVIDER_LABELS[board.provider]} ${board.boardIdentifier}`;
}

const toBoard = (s: BoardSuggestion): WatchBoard => ({
  provider: s.provider,
  boardIdentifier: s.boardIdentifier,
  boardUrl: s.boardUrl,
});

function jobsLabel(s: BoardSuggestion): string | null {
  if (s.openJobs === null) return null;
  return `${s.openJobs}${s.openJobsAtLeast ? "+" : ""} open job${s.openJobs === 1 && !s.openJobsAtLeast ? "" : "s"}`;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "searching"; company: string }
  | { kind: "done"; result: BoardDiscoveryResult }
  | { kind: "failed"; message: string };

/**
 * Finds and selects up to three job boards for a company. Lookups start by themselves once a
 * company name is entered (after typing pauses) and can be re-run; strong matches are ticked
 * until the owner changes the selection. Boards can also be added from a pasted URL.
 */
export function BoardPicker({
  company,
  companyId,
  websiteUrl,
  selected,
  onChange,
  watchId,
  autoSearch,
  disabled,
}: {
  company: string;
  companyId: string | null;
  websiteUrl: string;
  selected: WatchBoard[];
  onChange: (boards: WatchBoard[]) => void;
  /** The watch being edited, so its own boards are not reported as taken. */
  watchId?: string;
  autoSearch: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [touched, setTouched] = useState(!autoSearch);
  const [manualUrl, setManualUrl] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  // Latest values for the async search callback, which outlives the render that started it.
  const selectedRef = useRef(selected);
  const touchedRef = useRef(touched);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    selectedRef.current = selected;
    touchedRef.current = touched;
    disabledRef.current = disabled;
  });

  const name = company.trim();
  const website = /^https?:\/\/\S+$/i.test(websiteUrl.trim()) ? websiteUrl.trim() : undefined;

  async function search() {
    if (disabledRef.current || (name.length < 2 && !companyId)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const run = ++sequence.current;
    setState({ kind: "searching", company: name });
    const result = await readWatchlist<BoardDiscoveryResult>(
      "boards",
      {
        ...(companyId ? { companyId } : { company: name }),
        ...(website ? { websiteUrl: website } : {}),
      },
      controller.signal,
    );
    if (controller.signal.aborted || run !== sequence.current) return;
    if (!result.ok) {
      setState({ kind: "failed", message: result.error.message });
      return;
    }
    setState({ kind: "done", result: result.data });
    if (!touchedRef.current && !disabledRef.current && result.data.ownershipChecked) {
      const keep = selectedRef.current;
      const strong = result.data.suggestions
        .filter((s) => s.confidence === "high" && !takenElsewhere(s))
        .map(toBoard)
        .filter((b) => !keep.some((k) => boardKey(k) === boardKey(b)));
      onChange([...keep, ...strong].slice(0, MAX_BOARDS_PER_WATCH));
    }
  }

  function takenElsewhere(s: BoardSuggestion) {
    return Boolean(s.watchedBy && s.watchedBy.watchId !== watchId);
  }

  // Look up boards by themselves once typing pauses; the effect only talks to the server.
  useEffect(() => {
    const handle =
      autoSearch && !disabled && (name.length >= 2 || companyId)
        ? setTimeout(() => void search(), 800)
        : undefined;
    return () => {
      clearTimeout(handle);
      request.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, name, companyId, website]);

  const full = selected.length >= MAX_BOARDS_PER_WATCH;
  const isSelected = (b: WatchBoard) => selected.some((s) => boardKey(s) === boardKey(b));

  function toggle(board: WatchBoard, on: boolean) {
    setTouched(true);
    onChange(
      on
        ? [...selected, board].slice(0, MAX_BOARDS_PER_WATCH)
        : selected.filter((s) => boardKey(s) !== boardKey(board)),
    );
  }

  function addManual() {
    setManualError(null);
    const raw = manualUrl.trim();
    const inferred = inferBoardFromUrl(raw);
    const board: WatchBoard | null = inferred
      ? {
          provider: inferred.provider,
          boardIdentifier: inferred.boardIdentifier,
          boardUrl: inferred.boardUrl,
        }
      : /^https?:\/\/\S+$/i.test(raw)
        ? { provider: "OTHER", boardIdentifier: null, boardUrl: raw }
        : null;
    if (!board) {
      setManualError("Paste a full URL starting with https://.");
      return;
    }
    if (isSelected(board)) {
      setManualError("That board is already selected.");
      return;
    }
    if (full) {
      setManualError(`A company can have at most ${MAX_BOARDS_PER_WATCH} boards.`);
      return;
    }
    toggle(board, true);
    setManualUrl("");
  }

  const suggestions = state.kind === "done" ? state.result.suggestions : [];

  return (
    <div className="space-y-3" aria-busy={state.kind === "searching"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Job boards</h3>
          <p className="text-muted-foreground text-xs">
            Up to {MAX_BOARDS_PER_WATCH}. jword checks Greenhouse, Lever, and Ashby for this
            company; you choose which to keep.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || state.kind === "searching" || (name.length < 2 && !companyId)}
          onClick={() => void search()}
        >
          <SearchIcon data-icon="inline-start" aria-hidden />
          {state.kind === "idle" ? "Find boards" : "Search again"}
        </Button>
      </div>

      <div role="status" aria-live="polite" className="text-muted-foreground text-xs">
        {state.kind === "searching" ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Checking Greenhouse, Lever, and Ashby for “{state.company}”…
          </span>
        ) : state.kind === "failed" ? (
          <span className="text-destructive">{state.message}</span>
        ) : state.kind === "done" ? (
          <>
            {suggestions.length
              ? `Found ${suggestions.length} board${suggestions.length === 1 ? "" : "s"} for “${state.result.company}”.`
              : `No public Greenhouse, Lever, or Ashby board found for “${state.result.company}” (tried ${state.result.candidates.join(", ") || "no names"}). Add one by URL below, or save without a board.`}
            {state.result.unavailable.length
              ? ` Could not complete checks on ${state.result.unavailable.map((p) => ATS_PROVIDER_LABELS[p]).join(", ")}; try again later.`
              : ""}
            {state.result.incomplete.length
              ? ` Some checks on ${state.result.incomplete.map((p) => ATS_PROVIDER_LABELS[p]).join(", ")} did not finish; missing results are unverified.`
              : ""}
            {state.result.warnings.map((warning) => ` ${warning}`).join("")}
          </>
        ) : name.length < 2 && !companyId ? (
          "Enter the company to look up its boards."
        ) : null}
      </div>

      {suggestions.length ? (
        <ul className="space-y-2" aria-label="Found boards">
          {suggestions.map((s) => {
            const board = toBoard(s);
            const checked = isSelected(board);
            const taken = takenElsewhere(s);
            const id = `board-${s.provider}-${s.boardIdentifier}`;
            const jobs = jobsLabel(s);
            return (
              <li
                key={boardKey(board)}
                className={cn("flex gap-3 rounded-md border p-2.5", checked && "border-primary/50")}
                data-testid="board-suggestion"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled || taken || (!checked && full)}
                  onCheckedChange={(v) => toggle(board, v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Label htmlFor={id} className="font-medium">
                      {ATS_PROVIDER_LABELS[s.provider]}{" "}
                      <span className="font-mono text-xs">{s.boardIdentifier}</span>
                    </Label>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        CONFIDENCE_STYLE[s.confidence],
                      )}
                    >
                      {CONFIDENCE_LABELS[s.confidence]}
                    </span>
                    {jobs ? <span className="text-muted-foreground text-xs">{jobs}</span> : null}
                    <a
                      href={s.boardUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center"
                      aria-label={`Open ${ATS_PROVIDER_LABELS[s.provider]} board ${s.boardIdentifier}`}
                    >
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {taken ? `Already watched for ${s.watchedBy!.company}. ` : ""}
                    {s.reasons.join(". ")}
                    {s.sampleTitles.length ? `. For example: ${s.sampleTitles.join("; ")}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="watch-manual-board">Add a board by URL</Label>
        <div className="flex gap-2">
          <Input
            id="watch-manual-board"
            type="url"
            inputMode="url"
            placeholder="https://jobs.lever.co/… or a careers page"
            value={manualUrl}
            disabled={disabled}
            onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            aria-describedby="watch-manual-board-hint"
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !manualUrl.trim()}
            onClick={addManual}
          >
            Add
          </Button>
        </div>
        <p
          id="watch-manual-board-hint"
          className={cn("text-xs", manualError ? "text-destructive" : "text-muted-foreground")}
          role={manualError ? "alert" : undefined}
        >
          {manualError ??
            "Greenhouse, Lever, and Ashby links become that board; any other link is kept as a careers page."}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium">
          Selected ({selected.length}/{MAX_BOARDS_PER_WATCH})
        </p>
        {selected.length ? (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Selected boards">
            {selected.map((board) => (
              <li
                key={boardKey(board)}
                className="bg-muted inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-xs"
              >
                <span className="truncate">{boardLabel(board)}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6"
                  disabled={disabled}
                  aria-label={`Remove ${boardLabel(board)}`}
                  onClick={() => toggle(board, false)}
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            None. The company is still watched; jword just has nothing to read for it yet.
          </p>
        )}
      </div>
    </div>
  );
}
