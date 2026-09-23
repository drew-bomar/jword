"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  buildCapturePatch,
  planCaptureUpdate,
  type ApplicationDetail,
  type ApplicationPriority,
  type ApplicationStatus,
  type CaptureFieldPlan,
  type CaptureFieldValues,
  type CaptureUpdateField,
  type CapturedPosting,
  type WorkArrangement,
} from "@jword/core/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { CaptureApi } from "./api";

interface Draft {
  company: string;
  title: string;
  jobUrl: string;
  externalJobId: string;
  location: string;
  workArrangement: WorkArrangement;
  datePosted: string;
  source: string;
  description: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
}

interface TargetOption {
  applicationId: string;
  company: string;
  title: string;
  status: string;
  reason: string;
}

type Target = { kind: "new" } | { kind: "existing"; applicationId: string } | null;

const FIELD_LABELS: Record<CaptureUpdateField, string> = {
  jobUrl: "Job URL",
  externalJobId: "External job ID",
  location: "Location",
  workArrangement: "Work arrangement",
  datePosted: "Date posted",
  source: "Source",
  description: "Description",
};

const MATCH_REASONS: Record<string, string> = {
  company_title: "same company and role",
  job_url: "same job URL",
  external_job_id: "same job ID",
};

function draftFrom(posting: CapturedPosting): Draft {
  return {
    company: posting.company ?? "",
    title: posting.title ?? "",
    jobUrl: posting.jobUrl ?? "",
    externalJobId: posting.externalJobId ?? "",
    location: posting.location ?? "",
    workArrangement: posting.workArrangement ?? "UNKNOWN",
    datePosted: posting.datePosted ?? "",
    source: posting.source ?? "",
    description: posting.description ?? "",
    // Captures usually happen while applying; the owner can pick another status before saving.
    status: "APPLIED",
    priority: "MEDIUM",
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

function capturedValues(draft: Draft): CaptureFieldValues {
  return {
    jobUrl: orNull(draft.jobUrl),
    externalJobId: orNull(draft.externalJobId),
    location: orNull(draft.location),
    workArrangement: draft.workArrangement === "UNKNOWN" ? null : draft.workArrangement,
    datePosted: orNull(draft.datePosted),
    source: orNull(draft.source),
    description: orNull(draft.description),
  };
}

/** Identity of the duplicate probe; candidates are only trusted for the draft they checked. */
function probeKey(draft: Draft): string {
  return JSON.stringify(
    [draft.company, draft.title, draft.jobUrl, draft.externalJobId].map(orNull),
  );
}

function display(field: CaptureUpdateField, value: string | null): string {
  if (value === null) return "blank";
  if (field === "workArrangement") return WORK_ARRANGEMENT_LABELS[value as WorkArrangement];
  if (field === "description" && value.length > 160) return `${value.slice(0, 160)}…`;
  return value;
}

/**
 * Review a captured posting, then add it or update an application the owner picks (decisions 016
 * and 017). Rendered in the extension's in-page overlay; every read and save goes through `api`.
 * `jwordUrl` is the tracker's origin, for links that open jword in a normal tab.
 */
export function CaptureReview({
  posting,
  api,
  jwordUrl,
}: {
  posting: CapturedPosting;
  api: CaptureApi;
  jwordUrl: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(posting));
  const [candidates, setCandidates] = useState<TargetOption[] | null>(null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<TargetOption[] | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const [existing, setExisting] = useState<ApplicationDetail | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<CaptureUpdateField, boolean>>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<{ applicationId: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookingUp, startLookup] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const locked = pending || unconfirmed;

  const key = probeKey(draft);
  const canProbe = draft.company.trim() !== "" && draft.title.trim() !== "";

  function checkMatches(forDraft: Draft) {
    if (!forDraft.company.trim() || !forDraft.title.trim()) return;
    startLookup(async () => {
      const result = await api.findDuplicates({
        company: forDraft.company,
        title: forDraft.title,
        jobUrl: orNull(forDraft.jobUrl),
        externalJobId: orNull(forDraft.externalJobId),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const options = result.data.map((c) => ({
        applicationId: c.applicationId,
        company: c.company,
        title: c.title,
        status: c.status,
        reason: c.matchedOn.map((m) => MATCH_REASONS[m] ?? m).join(", "),
      }));
      setCandidates(options);
      setCheckedKey(probeKey(forDraft));
      // Never pick an existing record for the owner; "new" is only the default with no matches.
      setTarget((current) => current ?? (options.length === 0 ? { kind: "new" } : null));
    });
  }

  // Check for matches once, as soon as the posting arrives.
  const checkPosting = useEffectEvent((arrived: CapturedPosting) =>
    checkMatches(draftFrom(arrived)),
  );
  useEffect(() => {
    checkPosting(posting);
  }, [posting]);

  async function loadExisting(applicationId: string) {
    const result = await api.getApplication({ applicationId });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setExisting(result.data);
    return result.data;
  }

  function chooseTarget(next: Target) {
    setTarget(next);
    setError(null);
    setNotice(null);
    setExisting(null);
    setOverrides({});
    if (next?.kind === "existing")
      startLookup(() => loadExisting(next.applicationId).then(() => {}));
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!searchText.trim()) return;
    startLookup(async () => {
      const result = await api.searchApplications({ text: searchText });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSearchResults(
        result.data.items.map((item) => ({
          applicationId: item.applicationId,
          company: item.company,
          title: item.title,
          status: item.status,
          reason: "search result",
        })),
      );
    });
  }

  const plan: CaptureFieldPlan[] = useMemo(
    () => (existing ? planCaptureUpdate(existing, capturedValues(draft)) : []),
    [existing, draft],
  );
  const selected = useMemo(
    () =>
      new Set(
        plan
          .filter((row) => row.selectable && (overrides[row.field] ?? row.defaultSelected))
          .map((row) => row.field),
      ),
    [plan, overrides],
  );
  const patch = buildCapturePatch(plan, selected);

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [field]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked || !target) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      if (target.kind === "new") {
        const reviewed = checkedKey === key && (candidates?.length ?? 0) > 0;
        const result = await save(
          {
            company: draft.company,
            title: draft.title,
            status: draft.status,
            priority: draft.priority,
            jobUrl: orNull(draft.jobUrl),
            externalJobId: orNull(draft.externalJobId),
            location: orNull(draft.location),
            workArrangement: draft.workArrangement,
            datePosted: orNull(draft.datePosted),
            source: orNull(draft.source),
            description: orNull(draft.description),
            // The owner saw these candidates and still chose a new application.
            allowDuplicate: reviewed || undefined,
          },
          api.createApplication,
        );
        if (!result.ok) {
          if (result.error.code === "CONFLICT" && result.error.reason === "DUPLICATE_CANDIDATES") {
            setCandidates(
              (result.error.candidates ?? []).map((c) => ({
                applicationId: c.applicationId,
                company: c.company,
                title: c.title,
                status: c.status,
                reason: c.matchedOn.map((m) => MATCH_REASONS[m] ?? m).join(", "),
              })),
            );
            setCheckedKey(key);
            setTarget(null);
            setNotice(
              "Similar applications already exist, so nothing was created. Choose one to update, or choose New application again to add a separate one.",
            );
            return;
          }
          setError(result.error);
          return;
        }
        setDone({
          applicationId: result.data.applicationId!,
          message: result.data.replayed ? "Earlier save confirmed." : result.data.summary,
        });
        return;
      }

      if (!existing) return;
      const result = await save(
        { applicationId: existing.applicationId, expectedVersion: existing.version, ...patch },
        api.updatePosting,
      );
      if (!result.ok) {
        if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
          // Keep the draft and the owner's selections; show the latest saved values to review.
          await loadExisting(existing.applicationId);
          setNotice(
            "This application changed since you opened it. The current values below were refreshed; review them and save again.",
          );
          return;
        }
        setError(result.error);
        return;
      }
      setDone({
        applicationId: existing.applicationId,
        message: result.data.replayed
          ? "Earlier save confirmed."
          : result.data.noop
            ? "Nothing changed; the application already had these values."
            : result.data.summary,
      });
    });
  }

  if (done) {
    return (
      <Alert role="status">
        <AlertTitle>Saved to jword</AlertTitle>
        <AlertDescription>
          <p>{done.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a
                href={`${jwordUrl}/applications/${done.applicationId}`}
                target="_blank"
                rel="noopener"
              >
                Open application
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            To capture another job, open its posting and click the jword button again.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const fieldErrors = error?.fieldErrors;
  const options = [
    ...(candidates ?? []),
    ...(searchResults ?? []).filter(
      (r) => !(candidates ?? []).some((c) => c.applicationId === r.applicationId),
    ),
  ];
  const saveDisabled =
    locked ||
    lookingUp ||
    !target ||
    (target.kind === "new" && !canProbe) ||
    (target.kind === "existing" && (!existing || Object.keys(patch).length === 0) && !unconfirmed);

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {posting.error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>The posting could not be read</AlertTitle>
          <AlertDescription>
            {posting.error} You can still fill in the fields below.
          </AlertDescription>
        </Alert>
      ) : null}
      {posting.guessed.length ? (
        <Alert role="note">
          <AlertDescription>
            Check {posting.guessed.join(" and ")}: the value was guessed from the page, not read
            from the posting.
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert role="alert">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error?.code === "UNAUTHENTICATED" ? (
        <Alert role="alert">
          <AlertTitle>Signed out of jword</AlertTitle>
          <AlertDescription>
            <p>Sign in to jword in a tab, then try again. This posting is kept.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={`${jwordUrl}/sign-in`} target="_blank" rel="noopener">
                  Sign in to jword
                </a>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  checkMatches(draft);
                }}
              >
                Try again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : error && !fieldErrors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="posting-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="posting-heading" className="text-sm font-semibold">
            Posting
          </h2>
          {posting.pageUrl ? (
            <a
              href={posting.pageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground max-w-full truncate text-xs underline"
            >
              {new URL(posting.pageUrl).hostname}
            </a>
          ) : null}
        </div>
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Company *"
            name="company"
            draft={draft}
            set={set}
            errors={fieldErrors}
          />
          <TextField label="Role *" name="title" draft={draft} set={set} errors={fieldErrors} />
          <TextField
            label="Location"
            name="location"
            draft={draft}
            set={set}
            errors={fieldErrors}
          />
          <div className="space-y-1.5">
            <Label htmlFor="capture-workArrangement">Work arrangement</Label>
            <Select
              value={draft.workArrangement}
              onValueChange={(v) => set("workArrangement", v as WorkArrangement)}
              disabled={locked}
            >
              <SelectTrigger id="capture-workArrangement" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_ARRANGEMENTS.map((w) => (
                  <SelectItem key={w} value={w}>
                    {WORK_ARRANGEMENT_LABELS[w]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <TextField label="Job URL" name="jobUrl" draft={draft} set={set} errors={fieldErrors} />
          </div>
          <TextField
            label="External job ID"
            name="externalJobId"
            draft={draft}
            set={set}
            errors={fieldErrors}
          />
          <TextField
            label="Date posted"
            name="datePosted"
            type="date"
            draft={draft}
            set={set}
            errors={fieldErrors}
          />
          <TextField label="Source" name="source" draft={draft} set={set} errors={fieldErrors} />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="capture-description">Description</Label>
            <Textarea
              id="capture-description"
              rows={8}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.description)}
            />
            {!posting.description ? (
              <p className="text-muted-foreground text-xs">
                No description was read. Some sites (LinkedIn) load it only after you scroll to it;
                capture again after scrolling, or paste it here.
              </p>
            ) : null}
            <FieldError errors={fieldErrors} name="description" />
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="target-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="target-heading" className="text-sm font-semibold">
            Save to
          </h2>
          {canProbe && checkedKey !== key ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked || lookingUp}
              onClick={() => checkMatches(draft)}
            >
              Check for matches again
            </Button>
          ) : null}
        </div>
        {candidates === null && lookingUp ? (
          <p className="text-muted-foreground text-sm">Looking for matching applications…</p>
        ) : candidates && candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching applications found.</p>
        ) : candidates ? (
          <p className="text-sm">
            {candidates.length === 1
              ? "One application looks like this posting."
              : `${candidates.length} applications look like this posting.`}{" "}
            Choose what to do.
          </p>
        ) : null}

        <fieldset disabled={locked} className="space-y-2">
          <legend className="sr-only">Save to</legend>
          {options.map((option) => (
            <label
              key={option.applicationId}
              className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name="capture-target"
                className="mt-1"
                checked={
                  target?.kind === "existing" && target.applicationId === option.applicationId
                }
                onChange={() =>
                  chooseTarget({ kind: "existing", applicationId: option.applicationId })
                }
              />
              <span>
                <span className="font-medium">
                  Update {option.company} — {option.title}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {STATUS_LABELS[option.status as ApplicationStatus] ?? option.status} ·{" "}
                  {option.reason}
                </span>
              </span>
            </label>
          ))}
          <label className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
            <input
              type="radio"
              name="capture-target"
              className="mt-1"
              checked={target?.kind === "new"}
              onChange={() => chooseTarget({ kind: "new" })}
            />
            <span>
              <span className="font-medium">New application</span>
              <span className="text-muted-foreground block text-xs">
                {options.length
                  ? "Adds a separate application even though similar ones exist."
                  : "Adds this posting to your tracker."}
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex gap-2">
          <Label htmlFor="capture-search" className="sr-only">
            Find another application
          </Label>
          <Input
            id="capture-search"
            placeholder="Find another application by company or role"
            value={searchText}
            disabled={locked}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={locked || lookingUp}
            onClick={(e) => runSearch(e)}
          >
            Search
          </Button>
        </div>
        {searchResults && searchResults.length === 0 ? (
          <p className="text-muted-foreground text-sm">No applications match that search.</p>
        ) : null}
      </section>

      {target?.kind === "new" ? (
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">New application settings</legend>
          <div className="space-y-1.5">
            <Label htmlFor="capture-status">Status</Label>
            <Select
              value={draft.status}
              onValueChange={(v) => set("status", v as ApplicationStatus)}
              disabled={locked}
            >
              <SelectTrigger id="capture-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capture-priority">Priority</Label>
            <Select
              value={draft.priority}
              onValueChange={(v) => set("priority", v as ApplicationPriority)}
              disabled={locked}
            >
              <SelectTrigger id="capture-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Date found is set to today (Central time)
            {draft.status === "APPLIED" ? ", and date applied too" : ""}.
          </p>
        </fieldset>
      ) : null}

      {target?.kind === "existing" ? (
        existing ? (
          <UpdatePlan
            plan={plan}
            selected={selected}
            disabled={locked}
            onToggle={(field, checked) => setOverrides((o) => ({ ...o, [field]: checked }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">Loading the current application…</p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saveDisabled}>
          {pending
            ? "Saving…"
            : unconfirmed
              ? "Retry original save"
              : target?.kind === "existing"
                ? "Update application"
                : "Add application"}
        </Button>
        {!target ? (
          <p className="text-muted-foreground text-sm">Choose where to save this posting.</p>
        ) : target.kind === "existing" && existing && Object.keys(patch).length === 0 ? (
          <p className="text-muted-foreground text-sm">Select at least one field to update.</p>
        ) : null}
      </div>
      {unconfirmed ? (
        <p className="text-muted-foreground text-sm" role="status">
          The last save is unconfirmed. Retry it before changing anything else.
        </p>
      ) : null}
    </form>
  );
}

function UpdatePlan({
  plan,
  selected,
  disabled,
  onToggle,
}: {
  plan: CaptureFieldPlan[];
  selected: ReadonlySet<CaptureUpdateField>;
  disabled: boolean;
  onToggle: (field: CaptureUpdateField, checked: boolean) => void;
}) {
  const changes = plan.filter((row) => row.selectable);
  // The posting says nothing here but the application has a value: a capture never clears it.
  const kept = plan.filter((row) => row.change === "missing" && row.current !== null);
  const unchanged = plan.filter((row) => !row.selectable && !kept.includes(row));
  return (
    <section aria-labelledby="update-heading" className="space-y-2">
      <h2 id="update-heading" className="text-sm font-semibold">
        Fields to update
      </h2>
      <p className="text-muted-foreground text-xs">
        Blank fields are selected. Fields that would replace an existing value stay unselected until
        you tick them. Status, priority, company, and role are never changed here.
      </p>
      {changes.length === 0 ? (
        <p className="text-sm">Nothing in the posting would change this application.</p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="capture-plan">
          {changes.map((row) => {
            const id = `capture-field-${row.field}`;
            return (
              <li key={row.field} className="flex items-start gap-3 p-3 text-sm">
                <Checkbox
                  id={id}
                  checked={selected.has(row.field)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onToggle(row.field, checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer space-y-0.5">
                  <span className="font-medium">
                    {FIELD_LABELS[row.field]}{" "}
                    <span className="text-muted-foreground text-xs font-normal">
                      {row.change === "fill" ? "(currently blank)" : "(replaces current value)"}
                    </span>
                  </span>
                  {row.change === "overwrite" ? (
                    <span className="text-muted-foreground block break-words">
                      Current: {display(row.field, row.current)}
                    </span>
                  ) : null}
                  <span className="block break-words">New: {display(row.field, row.captured)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {kept.length ? (
        <ul className="bg-muted/40 divide-y rounded-md border" data-testid="capture-kept">
          {kept.map((row) => (
            <li key={row.field} className="p-3 text-sm">
              <span className="font-medium">{FIELD_LABELS[row.field]}</span>: keeping{" "}
              {display(row.field, row.current)}{" "}
              <span className="text-muted-foreground text-xs">(not in posting)</span>
            </li>
          ))}
        </ul>
      ) : null}
      {unchanged.length ? (
        <p className="text-muted-foreground text-xs">
          Not changed:{" "}
          {unchanged
            .map(
              (row) =>
                `${FIELD_LABELS[row.field].toLowerCase()} (${row.change === "same" ? "same" : "not in posting"})`,
            )
            .join(", ")}
          .
        </p>
      ) : null}
    </section>
  );
}

function TextField({
  label,
  name,
  type = "text",
  draft,
  set,
  errors,
}: {
  label: string;
  name: "company" | "title" | "location" | "jobUrl" | "externalJobId" | "datePosted" | "source";
  type?: string;
  draft: Draft;
  set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  errors: Record<string, string[]> | undefined;
}) {
  const id = `capture-${name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={draft[name]}
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={Boolean(errors?.[name])}
        aria-describedby={errors?.[name] ? `${id}-error` : undefined}
      />
      <FieldError errors={errors} name={name} />
    </div>
  );
}

function FieldError({
  errors,
  name,
}: {
  errors: Record<string, string[]> | undefined;
  name: string;
}) {
  const messages = errors?.[name];
  if (!messages?.length) return null;
  return (
    <p id={`capture-${name}-error`} className="text-destructive text-xs" role="alert">
      {messages[0]}
    </p>
  );
}
