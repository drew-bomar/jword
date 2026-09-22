"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  type ApplicationDetail,
  type ApplicationPriority,
  type ApplicationStatus,
  type DuplicateCandidate,
  type WorkArrangement,
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
import { createApplicationAction, updateDetailsAction } from "@/server/actions/applications";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import type { ActionError } from "@/server/actions/result";

export interface ApplicationFormValues {
  company: string;
  title: string;
  jobUrl: string;
  externalJobId: string;
  location: string;
  workArrangement: WorkArrangement;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  dateFound: string;
  appliedAt: string;
  source: string;
  resumeVersion: string;
  referral: string;
  initialNote: string;
}

export function valuesFromApplication(app: ApplicationDetail): ApplicationFormValues {
  return {
    company: app.company,
    title: app.title,
    jobUrl: app.jobUrl ?? "",
    externalJobId: app.externalJobId ?? "",
    location: app.location ?? "",
    workArrangement: app.workArrangement,
    status: app.status,
    priority: app.priority,
    dateFound: app.dateFound ?? "",
    appliedAt: app.appliedAt ?? "",
    source: app.source ?? "",
    resumeVersion: app.resumeVersion ?? "",
    referral: app.referral ?? "",
    initialNote: "",
  };
}

const EMPTY: ApplicationFormValues = {
  company: "",
  title: "",
  jobUrl: "",
  externalJobId: "",
  location: "",
  workArrangement: "UNKNOWN",
  status: "SAVED",
  priority: "MEDIUM",
  dateFound: "",
  appliedAt: "",
  source: "",
  resumeVersion: "",
  referral: "",
  initialNote: "",
};

type Mode =
  | { kind: "create"; today: string }
  | { kind: "edit"; application: ApplicationDetail; onSaved: () => void; onCancel: () => void };

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
    <p id={`${name}-error`} className="text-destructive text-xs" role="alert">
      {messages[0]}
    </p>
  );
}

/**
 * Shared create/edit form. Business rules live in the shared services; this component only
 * collects input, shows validation results, and handles the duplicate and stale-version flows.
 */
export function ApplicationForm({
  mode,
  onBusyChange,
}: {
  mode: Mode;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      mode.kind === "edit"
        ? valuesFromApplication(mode.application)
        : { ...EMPTY, dateFound: mode.today },
    [mode],
  );
  const [values, setValues] = useState<ApplicationFormValues>(initial);
  const [error, setError] = useState<ActionError | null>(null);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [stale, setStale] = useState(false);
  const { save, unconfirmed } = useReliableMutation();
  useEffect(() => {
    onBusyChange?.(pending || unconfirmed);
  }, [pending, unconfirmed, onBusyChange]);
  const [baseline, setBaseline] = useState(initial);
  const [expectedVersion, setExpectedVersion] = useState(
    mode.kind === "edit" ? mode.application.version : 0,
  );
  const newer = mode.kind === "edit" && mode.application.version !== expectedVersion;

  const set = <K extends keyof ApplicationFormValues>(key: K, value: ApplicationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());

  function submit(event: React.FormEvent, allowDuplicate = false) {
    event.preventDefault();
    if (pending || ((stale || newer) && !unconfirmed)) return;
    setError(null);
    setCandidates(null);
    startTransition(async () => {
      if (mode.kind === "create") {
        const result = await save(
          {
            company: values.company,
            title: values.title,
            status: values.status,
            priority: values.priority,
            jobUrl: textOrNull(values.jobUrl),
            externalJobId: textOrNull(values.externalJobId),
            location: textOrNull(values.location),
            workArrangement: values.workArrangement,
            // Explicit values or explicit null: the form always shows the resolved date.
            dateFound: textOrNull(values.dateFound),
            appliedAt:
              values.status === "APPLIED" && values.appliedAt.trim() === ""
                ? undefined
                : textOrNull(values.appliedAt),
            source: textOrNull(values.source),
            resumeVersion: textOrNull(values.resumeVersion),
            referral: textOrNull(values.referral),
            initialNote: textOrNull(values.initialNote),
            allowDuplicate: allowDuplicate || undefined,
          },
          createApplicationAction,
        );
        if (!result.ok) {
          if (result.error.code === "CONFLICT" && result.error.reason === "DUPLICATE_CANDIDATES") {
            setCandidates(result.error.candidates ?? []);
            return;
          }
          setError(result.error);
          return;
        }
        toast.success(result.data.replayed ? "Earlier save confirmed." : result.data.summary);
        router.push(`/applications/${result.data.applicationId}`);
        return;
      }

      const app = mode.application;
      const changed = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) => value !== baseline[key as keyof ApplicationFormValues],
        ),
      );
      const editable = {
        company: values.company,
        title: values.title,
        priority: values.priority,
        jobUrl: textOrNull(values.jobUrl),
        externalJobId: textOrNull(values.externalJobId),
        location: textOrNull(values.location),
        workArrangement: values.workArrangement,
        dateFound: textOrNull(values.dateFound),
        appliedAt: textOrNull(values.appliedAt),
        source: textOrNull(values.source),
        resumeVersion: textOrNull(values.resumeVersion),
        referral: textOrNull(values.referral),
      };
      const patch = Object.fromEntries(Object.entries(editable).filter(([key]) => key in changed));
      if (!Object.keys(patch).length && !unconfirmed) {
        mode.onSaved();
        return;
      }
      const result = await save(
        { applicationId: app.applicationId, expectedVersion, ...patch },
        updateDetailsAction,
      );
      if (!result.ok) {
        if (result.error.code === "CONFLICT" && result.error.reason === "STALE_VERSION") {
          setStale(true);
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
      mode.onSaved();
    });
  }

  const fieldErrors = error?.fieldErrors;
  const isEdit = mode.kind === "edit";

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {stale || newer ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>This application changed since you opened it.</AlertTitle>
          <AlertDescription>
            Your draft is kept below. Refresh, review the latest saved values, then choose to
            reapply your edits.
          </AlertDescription>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                router.refresh();
              }}
            >
              Refresh latest values
            </Button>
            {newer && mode.kind === "edit" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const latest = valuesFromApplication(mode.application);
                  const draft = Object.fromEntries(
                    Object.entries(values).filter(
                      ([key, value]) => value !== baseline[key as keyof ApplicationFormValues],
                    ),
                  );
                  setValues({ ...latest, ...draft });
                  setBaseline(latest);
                  setExpectedVersion(mode.application.version);
                  setStale(false);
                }}
              >
                Reapply my edits
              </Button>
            ) : null}
          </div>
          {newer && mode.kind === "edit" ? (
            <dl className="mt-2 text-sm">
              {Object.entries(valuesFromApplication(mode.application))
                .filter(([key, value]) => value !== baseline[key as keyof ApplicationFormValues])
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium">
                      Latest saved{" "}
                      {key === "appliedAt"
                        ? "date applied"
                        : key === "title"
                          ? "role"
                          : key.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </dt>
                    <dd>{value || "blank"}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </Alert>
      ) : null}
      {error && !fieldErrors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {candidates ? (
        <Alert role="alert">
          <AlertTitle>Possible duplicate</AlertTitle>
          <AlertDescription>
            <p>Similar applications already exist. Nothing was created.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {candidates.map((c) => (
                <li key={c.applicationId}>
                  <Link href={`/applications/${c.applicationId}`} className="underline">
                    {c.company} — {c.title}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    ({STATUS_LABELS[c.status as ApplicationStatus] ?? c.status})
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || ((stale || newer) && !unconfirmed)}
              onClick={(e) => submit(e, true)}
            >
              Create anyway as a separate application
            </Button>
          </div>
        </Alert>
      ) : null}

      <fieldset disabled={pending || unconfirmed} className="contents">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="company">Company *</Label>
            <Input
              id="company"
              name="company"
              required
              value={values.company}
              onChange={(e) => set("company", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.company)}
              aria-describedby={fieldErrors?.company ? "company-error" : undefined}
              autoFocus={!isEdit}
            />
            <FieldError errors={fieldErrors} name="company" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Role *</Label>
            <Input
              id="title"
              name="title"
              required
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.title)}
              aria-describedby={fieldErrors?.title ? "title-error" : undefined}
            />
            <FieldError errors={fieldErrors} name="title" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="jobUrl">Job URL</Label>
            <Input
              id="jobUrl"
              name="jobUrl"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={values.jobUrl}
              onChange={(e) => set("jobUrl", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.jobUrl)}
            />
            <FieldError errors={fieldErrors} name="jobUrl" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="externalJobId">External job ID</Label>
            <Input
              id="externalJobId"
              name="externalJobId"
              value={values.externalJobId}
              onChange={(e) => set("externalJobId", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="externalJobId" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              name="location"
              value={values.location}
              onChange={(e) => set("location", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="location" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workArrangement">Work arrangement</Label>
            <Select
              value={values.workArrangement}
              onValueChange={(v) => set("workArrangement", v as WorkArrangement)}
            >
              <SelectTrigger id="workArrangement" className="w-full">
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
          {!isEdit ? (
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select
                value={values.status}
                onValueChange={(v) => set("status", v as ApplicationStatus)}
              >
                <SelectTrigger id="status" className="w-full">
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
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={values.priority}
              onValueChange={(v) => set("priority", v as ApplicationPriority)}
            >
              <SelectTrigger id="priority" className="w-full">
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
          <div className="space-y-1.5">
            <Label htmlFor="dateFound">Date found</Label>
            <Input
              id="dateFound"
              name="dateFound"
              type="date"
              value={values.dateFound}
              onChange={(e) => set("dateFound", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.dateFound)}
            />
            <FieldError errors={fieldErrors} name="dateFound" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appliedAt">Date applied</Label>
            <Input
              id="appliedAt"
              name="appliedAt"
              type="date"
              value={values.appliedAt}
              onChange={(e) => set("appliedAt", e.target.value)}
              aria-invalid={Boolean(fieldErrors?.appliedAt)}
              aria-describedby="appliedAt-hint"
            />
            <p id="appliedAt-hint" className="text-muted-foreground text-xs">
              {!isEdit && values.status === "APPLIED" && values.appliedAt.trim() === ""
                ? "Blank with status Applied: defaults to today (Central time). Enter a date to override."
                : "Leave blank if unknown."}
            </p>
            <FieldError errors={fieldErrors} name="appliedAt" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source">Source</Label>
            <Input
              id="source"
              name="source"
              placeholder="LinkedIn, referral, company site…"
              value={values.source}
              onChange={(e) => set("source", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="source" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resumeVersion">Resume version</Label>
            <Input
              id="resumeVersion"
              name="resumeVersion"
              placeholder="e.g. backend-v3"
              value={values.resumeVersion}
              onChange={(e) => set("resumeVersion", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="resumeVersion" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="referral">Referral</Label>
            <Input
              id="referral"
              name="referral"
              placeholder="Who referred you, if anyone"
              value={values.referral}
              onChange={(e) => set("referral", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="referral" />
          </div>
          {!isEdit ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="initialNote">Initial note</Label>
              <Textarea
                id="initialNote"
                name="initialNote"
                rows={3}
                value={values.initialNote}
                onChange={(e) => set("initialNote", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Saved as the first note in the Notes section. You can add more later.
              </p>
              <FieldError errors={fieldErrors} name="initialNote" />
            </div>
          ) : null}
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
                : "Add application"}
        </Button>
        {isEdit ? (
          <Button
            type="button"
            variant="ghost"
            onClick={mode.onCancel}
            disabled={pending || unconfirmed}
          >
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={pending || unconfirmed}
            onClick={() => router.push("/")}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
