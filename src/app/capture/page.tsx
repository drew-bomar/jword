import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CaptureWorkspace } from "@/features/capture/capture-workspace";
import { requirePageSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Capture job" };

/**
 * Shown in the jword extension's side panel (decision 016), which frames it with `?embed=1`.
 * The extension hands the posting to this page in the browser; saving uses the normal Server
 * Actions and session.
 */
export default async function CapturePage({ searchParams }: PageProps<"/capture">) {
  const session = await requirePageSession();
  const embedded = (await searchParams).embed === "1";
  const intro = (
    <p className="text-muted-foreground text-sm">
      Review what was read from the posting, then add it or update an application you already track.
      Nothing is saved until you confirm.
    </p>
  );

  if (embedded) {
    return (
      <main className="space-y-4 px-4 py-4">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-base font-semibold tracking-tight">Capture job</h1>
            <Link
              href="/"
              target="_blank"
              className="text-muted-foreground text-xs font-semibold tracking-tight"
            >
              jword ↗
            </Link>
          </div>
          {intro}
        </div>
        <CaptureWorkspace embedded />
      </main>
    );
  }

  return (
    <AppShell email={session.email}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Capture job</h1>
          {intro}
        </div>
        <CaptureWorkspace />
      </div>
    </AppShell>
  );
}
