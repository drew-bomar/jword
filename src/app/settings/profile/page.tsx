import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/features/profile/profile-form";
import { requirePageSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await requirePageSession();
  const profile = await servicesFor(session).getCandidateProfile(session.actor);
  return (
    <AppShell email={session.email}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Candidate profile</h1>
          <p className="text-muted-foreground text-sm">
            Basic details kept for future application autofill. Nothing here is required, and none
            of it is sent anywhere.
          </p>
        </div>
        <ProfileForm profile={profile} />
      </div>
    </AppShell>
  );
}
