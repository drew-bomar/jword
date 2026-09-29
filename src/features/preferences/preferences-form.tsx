"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import {
  CITY_CATALOG,
  CITY_KEYS,
  EMPLOYMENT_TARGET_LABELS,
  EMPLOYMENT_TARGETS,
  NEUTRAL_PREFERENCES,
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  TARGET_LEVEL_LABELS,
  TARGET_LEVELS,
  type CityKey,
  type EmploymentTarget,
  type RoleFamily,
  type SearchPreferences,
  type TargetLevel,
} from "@jword/core/browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { formatDate } from "@/lib/format";
import { useReliableMutation } from "@/lib/mutations/use-reliable-mutation";
import { saveSearchPreferencesAction } from "@/server/actions/preferences";
import type { ActionError } from "@/server/actions/result";

type RoleChoice = "PREFERRED" | "NEUTRAL" | "DEEMPHASIZED";

interface FormState {
  targetLevel: TargetLevel;
  employmentTarget: EmploymentTarget;
  preferredStartMonth: string;
  preferredCities: CityKey[];
  hideRemoteOnly: boolean;
  roles: Record<RoleFamily, RoleChoice>;
  maxPostingAgeDays: string;
}

function toForm(p: Omit<SearchPreferences, "version" | "updatedAt">): FormState {
  const roles = Object.fromEntries(
    ROLE_FAMILIES.map((role) => [
      role,
      p.preferredRoles.includes(role)
        ? "PREFERRED"
        : p.deemphasizedRoles.includes(role)
          ? "DEEMPHASIZED"
          : "NEUTRAL",
    ]),
  ) as Record<RoleFamily, RoleChoice>;
  return {
    targetLevel: p.targetLevel,
    employmentTarget: p.employmentTarget,
    preferredStartMonth: p.preferredStartMonth ?? "",
    preferredCities: [...p.preferredCities],
    hideRemoteOnly: p.hideRemoteOnly,
    roles,
    maxPostingAgeDays: p.maxPostingAgeDays ? String(p.maxPostingAgeDays) : "",
  };
}

function toCommand(form: FormState) {
  const age = form.maxPostingAgeDays.trim();
  return {
    targetLevel: form.targetLevel,
    employmentTarget: form.employmentTarget,
    preferredStartMonth: form.preferredStartMonth || null,
    preferredCities: form.preferredCities,
    hideRemoteOnly: form.hideRemoteOnly,
    preferredRoles: ROLE_FAMILIES.filter((r) => form.roles[r] === "PREFERRED"),
    deemphasizedRoles: ROLE_FAMILIES.filter((r) => form.roles[r] === "DEEMPHASIZED"),
    maxPostingAgeDays: age ? Number(age) : null,
  };
}

function FieldError({ error, field }: { error: ActionError | null; field: string }) {
  const message = error?.fieldErrors?.[field]?.[0];
  return message ? (
    <p className="text-destructive text-xs" role="alert">
      {message}
    </p>
  ) : null;
}

export function PreferencesForm({
  preferences,
  graduationDate,
}: {
  preferences: SearchPreferences | null;
  graduationDate: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(preferences ?? NEUTRAL_PREFERENCES));
  const [version, setVersion] = useState<number | null>(preferences?.version ?? null);
  const [error, setError] = useState<ActionError | null>(null);
  const [reevaluationPending, setReevaluationPending] = useState(false);
  const [pending, startTransition] = useTransition();
  const { save, unconfirmed } = useReliableMutation();
  const locked = pending || unconfirmed;
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const remaining = CITY_KEYS.filter((key) => !form.preferredCities.includes(key));
  function moveCity(index: number, delta: number) {
    const cities = [...form.preferredCities];
    const [city] = cities.splice(index, 1);
    cities.splice(index + delta, 0, city!);
    set({ preferredCities: cities });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const command = {
        ...toCommand(form),
        ...(version ? { expectedVersion: version } : {}),
      };
      const result = await save(command, saveSearchPreferencesAction);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setVersion(result.data.version);
      setReevaluationPending(result.data.reevaluationPending === true);
      if (result.data.reevaluationPending) {
        toast.warning("Preferences saved. Lead re-check is incomplete; save again to retry.");
      } else {
        toast.success(
          result.data.noop
            ? "Preferences unchanged."
            : `Preferences saved.${
                result.data.reevaluated ? ` Re-checked ${result.data.reevaluated} leads.` : ""
              }`,
        );
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label="Search preferences">
      {reevaluationPending ? (
        <Alert role="status">
          <AlertDescription>
            Your preferences are saved, but some lead labels may be outdated. Save again to retry
            the re-check.
          </AlertDescription>
        </Alert>
      ) : null}
      {error && !error.fieldErrors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {error.message}
            {error.reason === "STALE_VERSION" ? " Reload the page to see the latest values." : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      {preferences === null ? (
        <Alert>
          <AlertDescription>
            No preferences saved yet, so every collected posting is kept. Choose your settings and
            save to start filtering.
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={locked} className="space-y-6" aria-label="Preference values">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Role level</legend>
          <div className="space-y-1.5">
            <Label htmlFor="pref-level">Target level</Label>
            <Select
              value={form.targetLevel}
              onValueChange={(v) => set({ targetLevel: v as TargetLevel })}
            >
              <SelectTrigger id="pref-level" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {TARGET_LEVEL_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pref-employment">Employment type</Label>
            <Select
              value={form.employmentTarget}
              onValueChange={(v) => set({ employmentTarget: v as EmploymentTarget })}
            >
              <SelectTrigger id="pref-employment" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TARGETS.map((target) => (
                  <SelectItem key={target} value={target}>
                    {EMPLOYMENT_TARGET_LABELS[target]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pref-start">Preferred start month</Label>
            <Input
              id="pref-start"
              type="month"
              value={form.preferredStartMonth}
              onChange={(e) => set({ preferredStartMonth: e.target.value })}
              aria-describedby="pref-start-help"
            />
            <p id="pref-start-help" className="text-muted-foreground text-xs">
              A label only: earlier start dates are never filtered out.
            </p>
            <FieldError error={error} field="preferredStartMonth" />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Graduation</span>
            <p className="text-muted-foreground text-sm">
              {graduationDate ? formatDate(graduationDate) : "Not set in your profile"}
            </p>
            <p className="text-muted-foreground text-xs">
              Used only to skip postings that state an explicit graduation window excluding yours.
            </p>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Preferred cities, in order</legend>
          <p className="text-muted-foreground text-xs">
            Used for the &ldquo;Preferred city first&rdquo; sort. Other locations are never filtered
            out.
          </p>
          {form.preferredCities.length ? (
            <ol className="divide-y rounded-lg border" aria-label="Preferred cities">
              {form.preferredCities.map((city, index) => (
                <li key={city} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground w-5 text-xs tabular-nums">
                    {index + 1}.
                  </span>
                  <span className="flex-1">{CITY_CATALOG[city].label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => moveCity(index, -1)}
                    aria-label={`Move ${CITY_CATALOG[city].label} up`}
                  >
                    <ArrowUpIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === form.preferredCities.length - 1}
                    onClick={() => moveCity(index, 1)}
                    aria-label={`Move ${CITY_CATALOG[city].label} down`}
                  >
                    <ArrowDownIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      set({ preferredCities: form.preferredCities.filter((c) => c !== city) })
                    }
                    aria-label={`Remove ${CITY_CATALOG[city].label}`}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
          ) : null}
          {remaining.length && form.preferredCities.length < 10 ? (
            <Select
              value=""
              onValueChange={(v) =>
                set({ preferredCities: [...form.preferredCities, v as CityKey] })
              }
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Add a preferred city">
                <SelectValue placeholder="Add a city…" />
              </SelectTrigger>
              <SelectContent>
                {remaining.map((key) => (
                  <SelectItem key={key} value={key}>
                    {CITY_CATALOG[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <FieldError error={error} field="preferredCities" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Work arrangement</legend>
          <div className="flex items-start gap-2">
            <Checkbox
              id="pref-remote"
              checked={form.hideRemoteOnly}
              onCheckedChange={(checked) => set({ hideRemoteOnly: checked === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="pref-remote">Hide remote-only roles in the Recommended view</Label>
              <p className="text-muted-foreground text-xs">
                They stay available under Remote only and All. Roles with no stated arrangement are
                always shown.
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Role interests</legend>
          <p className="text-muted-foreground text-xs">
            Read from job titles. Labels and an optional filter only; no role type is ever skipped.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_FAMILIES.map((role) => (
              <div key={role} className="flex items-center justify-between gap-2">
                <Label htmlFor={`pref-role-${role}`} className="font-normal">
                  {ROLE_FAMILY_LABELS[role]}
                </Label>
                <Select
                  value={form.roles[role]}
                  onValueChange={(v) => set({ roles: { ...form.roles, [role]: v as RoleChoice } })}
                >
                  <SelectTrigger id={`pref-role-${role}`} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PREFERRED">Preferred</SelectItem>
                    <SelectItem value="NEUTRAL">Neutral</SelectItem>
                    <SelectItem value="DEEMPHASIZED">De-emphasized</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <FieldError error={error} field="deemphasizedRoles" />
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Posting age</legend>
          <Label htmlFor="pref-age" className="font-normal">
            Hide postings older than (days)
          </Label>
          <Input
            id="pref-age"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            placeholder="Off"
            className="w-32"
            value={form.maxPostingAgeDays}
            onChange={(e) => set({ maxPostingAgeDays: e.target.value })}
            aria-describedby="pref-age-help"
          />
          <p id="pref-age-help" className="text-muted-foreground text-xs">
            Leave blank to turn off. Postings with no stated date (all Workday postings) always
            stay.
          </p>
          <FieldError error={error} field="maxPostingAgeDays" />
        </fieldset>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : unconfirmed ? "Retry save" : "Save preferences"}
      </Button>
    </form>
  );
}
