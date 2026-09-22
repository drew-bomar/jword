"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CandidateProfile } from "@jword/core/browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { saveProfileAction } from "@/server/actions/profile";
import type { ActionError } from "@/server/actions/result";

const TEXT_FIELDS: Array<{
  key: keyof CandidateProfile;
  label: string;
  type?: string;
  autoComplete?: string;
}> = [
  { key: "fullName", label: "Full name", autoComplete: "name" },
  { key: "email", label: "Email", type: "email", autoComplete: "email" },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "location", label: "Location" },
  { key: "linkedinUrl", label: "LinkedIn URL", type: "url" },
  { key: "githubUrl", label: "GitHub URL", type: "url" },
  { key: "portfolioUrl", label: "Portfolio URL", type: "url" },
  { key: "school", label: "School" },
  { key: "degree", label: "Degree" },
  { key: "graduationDate", label: "Graduation date", type: "date" },
  { key: "workAuthorization", label: "Work authorization" },
];

type FormState = Record<string, string>;

function toForm(profile: CandidateProfile | null): FormState {
  const state: FormState = {};
  for (const f of TEXT_FIELDS) state[f.key] = (profile?.[f.key] as string | null | undefined) ?? "";
  state.requiresSponsorship =
    profile?.requiresSponsorship === null || profile?.requiresSponsorship === undefined
      ? "unknown"
      : profile.requiresSponsorship
        ? "yes"
        : "no";
  return state;
}

export function ProfileForm({ profile }: { profile: CandidateProfile | null }) {
  const [values, setValues] = useState<FormState>(() => toForm(profile));
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      for (const f of TEXT_FIELDS) payload[f.key] = values[f.key]?.trim() ? values[f.key] : null;
      payload.requiresSponsorship =
        values.requiresSponsorship === "unknown" ? null : values.requiresSponsorship === "yes";
      let result;
      try {
        result = await saveProfileAction(payload);
      } catch {
        setError({
          code: "OUTCOME_UNKNOWN",
          message:
            "The profile save is unconfirmed. Reload to check the saved values before trying again.",
        });
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValues(toForm(result.data));
      toast.success("Profile saved.");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && !error.fieldErrors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`profile-${f.key}`}>{f.label}</Label>
            <Input
              id={`profile-${f.key}`}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              aria-invalid={Boolean(error?.fieldErrors?.[f.key])}
            />
            {error?.fieldErrors?.[f.key]?.[0] ? (
              <p className="text-destructive text-xs" role="alert">
                {error.fieldErrors[f.key]![0]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="profile-sponsorship">Requires visa sponsorship</Label>
          <Select
            value={values.requiresSponsorship}
            onValueChange={(v) => setValues({ ...values, requiresSponsorship: v })}
          >
            <SelectTrigger id="profile-sponsorship" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Not specified</SelectItem>
              <SelectItem value="no">No</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
