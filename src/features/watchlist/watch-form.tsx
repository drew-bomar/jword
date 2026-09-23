"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  normalizeName,
  type CompanyOption,
  type WatchBoard,
  type WatchedCompany,
} from "@jword/core/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import type { ActionError } from "@/server/actions/result";
import {
  addWatchAction,
  searchCompaniesAction,
  setWatchStatusAction,
  updateWatchAction,
} from "@/server/actions/watchlist";
import { BoardPicker, boardLabel } from "./board-picker";

interface WatchFormValues {
  company: string;
  companyId: string | null;
  boards: WatchBoard[];
  interestLevel: string;
  websiteUrl: string;
  companyNotes: string;
}

const EMPTY: WatchFormValues = {
  company: "",
  companyId: null,
  boards: [],
  interestLevel: "",
  websiteUrl: "",
  companyNotes: "",
};

function valuesFromWatch(watch: WatchedCompany): WatchFormValues {
  return {
    company: watch.company,
    companyId: watch.companyId,
    boards: watch.boards,
    interestLevel: watch.interestLevel === null ? "" : String(watch.interestLevel),
    websiteUrl: watch.websiteUrl ?? "",
    companyNotes: watch.companyNotes ?? "",
  };
}

type Key = keyof WatchFormValues;
const same = (a: WatchFormValues[Key], b: WatchFormValues[Key]) =>
  JSON.stringify(a) === JSON.stringify(b);

const FIELD_LABELS: Record<Key, string> = {
  company: "company",
  companyId: "company",
  boards: "boards",
  interestLevel: "interest",
  websiteUrl: "website",
  companyNotes: "company notes",
};

const NO_INTEREST = "__none__";

type Mode = { kind: "add" } | { kind: "edit"; watch: WatchedCompany };

interface AlreadyWatched {
  watchId: string;
  active: boolean;
  version: number;
  message: string;
}

function FieldError({ errors, name }: { errors?: Record<string, string[]>; name: string }) {
  const messages = Object.entries(errors ?? {})
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .flatMap(([, list]) => list);
  if (!messages.length) return null;
  return (
    <p id={`watch-${name}-error`} className="text-destructive text-xs" role="alert">
      {messages[0]}
    </p>
  );
}

const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** Boards as the command sends them: supported boards by identifier, OTHER by careers URL. */
const boardsCommand = (boards: WatchBoard[]) =>
  boards.map((b) =>
    b.provider === "OTHER"
      ? { provider: b.provider, boardUrl: b.boardUrl }
      : { provider: b.provider, boardIdentifier: b.boardIdentifier },
  );

/**
 * Add/edit form for one watched company. Business rules live in the shared service and the
 * database function; this component collects input, runs board discovery through the picker,
 * and handles the duplicate, stale-version, and unconfirmed-save flows.
 */
export function WatchForm({
  mode,
  onSaved,
  onCancel,
  onBusyChange,
}: {
  mode: Mode;
  onSaved: () => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const initial = useMemo(
    () => (mode.kind === "edit" ? valuesFromWatch(mode.watch) : EMPTY),
    [mode],
  );
  const [values, setValues] = useState<WatchFormValues>(initial);
  const [baseline, setBaseline] = useState(initial);
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [error, setError] = useState<ActionError | null>(null);
  const [alreadyWatched, setAlreadyWatched] = useState<AlreadyWatched | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const reactivation = useReliableMutation();
  const [expectedVersion, setExpectedVersion] = useState(
    mode.kind === "edit" ? mode.watch.version : 0,
  );
  const newer = mode.kind === "edit" && mode.watch.version !== expectedVersion;
  const busy = pending || unconfirmed || reactivation.unconfirmed;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const set = <K extends Key>(key: K, value: WatchFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Existing-company suggestions while typing a name (add mode, nothing selected yet).
  const lookup = mode.kind === "add" && !values.companyId ? values.company.trim() : "";
  useEffect(() => {
    if (!lookup) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await searchCompaniesAction({ text: lookup });
      if (!cancelled) setOptions(result.ok ? result.data : []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [lookup]);
  const visibleOptions = lookup ? options : [];
  const exactMatch = visibleOptions.find(
    (o) => normalizeName(o.name) === normalizeName(values.company),
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || ((stale || newer) && !unconfirmed)) return;
    setError(null);
    setAlreadyWatched(null);
    startTransition(async () => {
      if (mode.kind === "add") {
        const result = await save(
          {
            company: values.company,
            companyId: values.companyId ?? undefined,
            boards: boardsCommand(values.boards),
            // Blank company fields leave an existing company's values unchanged.
            interestLevel: values.interestLevel ? Number(values.interestLevel) : undefined,
            websiteUrl: textOrNull(values.websiteUrl) ?? undefined,
            companyNotes: textOrNull(values.companyNotes) ?? undefined,
          },
          addWatchAction,
        );
        if (!result.ok) {
          if (result.error.code === "CONFLICT" && result.error.reason === "ALREADY_WATCHED") {
            setAlreadyWatched({
              watchId: result.error.watchId ?? "",
              active: result.error.watchActive ?? true,
              version: result.error.currentVersion ?? 1,
              message: result.error.message,
            });
            return;
          }
          if (result.error.code === "UNAUTHENTICATED") {
            router.push("/sign-in");
            return;
          }
          setError(result.error);
          return;
        }
        toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary);
        onSaved();
        return;
      }

      const changed = (Object.keys(values) as Key[]).filter((k) => !same(values[k], baseline[k]));
      const patch: Record<string, unknown> = {};
      if (changed.includes("boards")) patch.boards = boardsCommand(values.boards);
      if (changed.includes("interestLevel"))
        patch.interestLevel = values.interestLevel ? Number(values.interestLevel) : null;
      if (changed.includes("websiteUrl")) patch.websiteUrl = textOrNull(values.websiteUrl);
      if (changed.includes("companyNotes")) patch.companyNotes = textOrNull(values.companyNotes);
      if (!Object.keys(patch).length && !unconfirmed) {
        onCancel();
        return;
      }
      const result = await save(
        { watchId: mode.watch.watchId, expectedVersion, ...patch },
        updateWatchAction,
      );
      if (!result.ok) {
        if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
          setStale(true);
          return;
        }
        if (result.error.code === "UNAUTHENTICATED") {
          router.push("/sign-in");
          return;
        }
        setError(result.error);
        return;
      }
      toast.success(
        result.data.replayed
          ? "Earlier save confirmed."
          : result.data.noop
            ? "No changes to save."
            : result.data.summary,
      );
      onSaved();
    });
  }

  function reactivate() {
    if (!alreadyWatched) return;
    const target = alreadyWatched;
    startTransition(async () => {
      const result = await reactivation.save(
        { watchId: target.watchId, expectedVersion: target.version, active: true },
        setWatchStatusAction,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary);
      onSaved();
    });
  }

  const fieldErrors = error?.fieldErrors;
  const isEdit = mode.kind === "edit";
  const locked = pending || unconfirmed || reactivation.unconfirmed;
  const display = (key: Key, value: WatchFormValues[Key]) =>
    key === "boards"
      ? (value as WatchBoard[]).map(boardLabel).join(", ") || "none"
      : String(value) || "blank";

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {stale || newer ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>This watch changed since you opened it.</AlertTitle>
          <AlertDescription>
            Your draft is kept below. Refresh, review the latest saved values, then choose to
            reapply your edits.
          </AlertDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => router.refresh()}>
              Refresh latest values
            </Button>
            {newer && mode.kind === "edit" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const latest = valuesFromWatch(mode.watch);
                  const draft = Object.fromEntries(
                    Object.entries(values).filter(
                      ([key, value]) => !same(value, baseline[key as Key]),
                    ),
                  );
                  setValues({ ...latest, ...draft });
                  setBaseline(latest);
                  setExpectedVersion(mode.watch.version);
                  setStale(false);
                }}
              >
                Reapply my edits
              </Button>
            ) : null}
          </div>
          {newer && mode.kind === "edit" ? (
            <dl className="mt-2 text-sm">
              {(Object.entries(valuesFromWatch(mode.watch)) as Array<[Key, WatchFormValues[Key]]>)
                .filter(([key, value]) => key !== "companyId" && !same(value, baseline[key]))
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium">Latest saved {FIELD_LABELS[key]}</dt>
                    <dd>{display(key, value)}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </Alert>
      ) : null}

      {alreadyWatched ? (
        <Alert role="alert">
          <AlertTitle>Already on your watchlist</AlertTitle>
          <AlertDescription>
            <p>{alreadyWatched.message} Nothing was added.</p>
          </AlertDescription>
          {!alreadyWatched.active ? (
            <div className="mt-3">
              <Button type="button" size="sm" disabled={pending} onClick={reactivate}>
                {reactivation.unconfirmed ? "Retry reactivation" : "Reactivate it"}
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {error && !fieldErrors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {unconfirmed ? (
        <Alert role="status">
          <AlertDescription>
            The save result is unconfirmed. It may already have been saved. Retry the original save
            before making another change.
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="watch-company">Company *</Label>
          {isEdit ? (
            <p id="watch-company" className="text-sm font-medium">
              {values.company}
            </p>
          ) : values.companyId ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span id="watch-company" className="font-medium">
                {values.company}
              </span>
              <span className="text-muted-foreground">(existing company)</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setValues((v) => ({ ...v, companyId: null }))}
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="watch-company"
                required
                autoComplete="off"
                value={values.company}
                onChange={(e) => set("company", e.target.value)}
                aria-invalid={Boolean(fieldErrors?.company)}
                aria-describedby="watch-company-hint"
              />
              <p id="watch-company-hint" className="text-muted-foreground text-xs">
                {exactMatch
                  ? `Matches your existing company “${exactMatch.name}”; it will be reused.`
                  : "Reuses a company with exactly this name (ignoring case and spacing), or creates it."}
              </p>
              {visibleOptions.length ? (
                <ul aria-label="Existing companies" className="flex flex-wrap gap-1.5">
                  {visibleOptions.map((option) => (
                    <li key={option.companyId}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setValues((v) => ({
                            ...v,
                            company: option.name,
                            companyId: option.companyId,
                          }))
                        }
                      >
                        {option.name}
                        {option.watchId ? (
                          <span className="text-muted-foreground text-xs">
                            {option.watchActive ? "· watched" : "· inactive watch"}
                          </span>
                        ) : null}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <FieldError errors={fieldErrors} name="company" />
        </div>

        <div className="border-t pt-4">
          <BoardPicker
            company={values.company}
            companyId={values.companyId}
            websiteUrl={values.websiteUrl}
            selected={values.boards}
            onChange={(boards) => set("boards", boards)}
            watchId={mode.kind === "edit" ? mode.watch.watchId : undefined}
            autoSearch={!isEdit}
            disabled={locked}
          />
          <FieldError errors={fieldErrors} name="boards" />
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Company details</h3>
            <p className="text-muted-foreground text-xs">
              Shared with the company&apos;s applications.
              {!isEdit ? " Blank fields leave an existing company's values unchanged." : ""}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="watch-interest">Interest</Label>
              <Select
                value={values.interestLevel || NO_INTEREST}
                onValueChange={(v) => set("interestLevel", v === NO_INTEREST ? "" : v)}
              >
                <SelectTrigger id="watch-interest" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INTEREST}>Not set</SelectItem>
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <SelectItem key={n} value={n}>
                      {n === "1" ? "1 (low)" : n === "5" ? "5 (high)" : n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={fieldErrors} name="interestLevel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="watch-website">Website</Label>
              <Input
                id="watch-website"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={values.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                aria-invalid={Boolean(fieldErrors?.websiteUrl)}
              />
              <FieldError errors={fieldErrors} name="websiteUrl" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="watch-notes">Company notes</Label>
              <Textarea
                id="watch-notes"
                rows={3}
                value={values.companyNotes}
                onChange={(e) => set("companyNotes", e.target.value)}
              />
              <FieldError errors={fieldErrors} name="companyNotes" />
            </div>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || ((stale || newer) && !unconfirmed)}>
          {pending
            ? "Saving…"
            : unconfirmed
              ? "Retry original save"
              : isEdit
                ? "Save changes"
                : "Add to watchlist"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={locked}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
