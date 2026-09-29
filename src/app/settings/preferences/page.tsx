import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PreferencesForm } from "@/features/preferences/preferences-form";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Search preferences" };

export default async function PreferencesPage() {
  const session = await requirePageSession();
  const services = servicesFor(session);
  const [preferences, profile] = await Promise.all([
    services.getSearchPreferences(session.actor),
    services.getCandidateProfile(session.actor),
  ]);
  return (
    <AppShell email={session.email}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Search preferences</h1>
          <p className="text-muted-foreground text-sm">
            How jword sorts and filters collected leads. Only clear mismatches (internships, senior
            or management titles, non-engineering roles, an explicit graduation window that excludes
            yours) are skipped when new jobs are collected. Anything uncertain stays, with a note
            explaining why.
          </p>
        </div>
        <PreferencesForm
          preferences={preferences}
          graduationDate={profile?.graduationDate ?? null}
        />
        <p className="text-muted-foreground text-xs">
          Graduation date comes from your{" "}
          <Link href="/settings/profile" className="underline underline-offset-2">
            profile
          </Link>
          . Saving re-checks existing leads; nothing is deleted, dismissed, or marked closed.
          Postings skipped under earlier preferences appear on the next job check.
        </p>
      </div>
    </AppShell>
  );
}
