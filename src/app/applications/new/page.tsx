import type { Metadata } from "next";
import { createClock } from "@jword/core";
import { AppShell } from "@/components/app-shell";
import { ApplicationForm } from "@/features/applications/application-form";
import { serverEnv } from "@/lib/env";
import { requirePageSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Add application" };

export default async function NewApplicationPage() {
  const session = await requirePageSession();
  const today = createClock(serverEnv().timeZone).today();
  return (
    <AppShell email={session.email}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Add application</h1>
          <p className="text-muted-foreground text-sm">
            Only company and role are required. Everything else can be filled in later.
          </p>
        </div>
        <ApplicationForm mode={{ kind: "create", today }} />
      </div>
    </AppShell>
  );
}
