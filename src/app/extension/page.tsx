import type { Metadata } from "next";
import { DownloadIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Chrome extension" };

const STEPS = [
  "Download the extension and unzip it. Keep the unzipped folder: Chrome loads the extension from it.",
  "In Chrome, open chrome://extensions and turn on Developer mode (top right).",
  "Click Load unpacked and choose the unzipped folder.",
  "Pin jword capture to the toolbar (puzzle-piece icon → pin).",
  "Open a job posting and click the jword icon, or press Alt+Shift+J. Review the panel, then save.",
];

/** Install steps for the Developer-mode build (decision 027); the zip is built by ext:build. */
export default async function ExtensionPage() {
  const session = await requirePageSession();
  return (
    <AppShell session={session}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Chrome extension</h1>
          <p className="text-muted-foreground text-sm">
            Save a job to jword from the posting itself. The extension reads LinkedIn, Greenhouse,
            Lever, Ashby, Workday, and most company career pages, then shows a review panel beside
            the page. Nothing is saved until you confirm.
          </p>
        </div>
        <Button asChild>
          <a href="/downloads/jword-capture.zip" download>
            <DownloadIcon data-icon="inline-start" aria-hidden />
            Download jword capture
          </a>
        </Button>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="text-muted-foreground space-y-2 text-sm">
          <p>
            The extension uses your jword sign-in in this browser, so stay signed in here. It only
            reads a page when you click its button, and it sends that posting only to jword.
          </p>
          <p>
            Chrome may remind you that a developer-mode extension is installed. To update, download
            again, replace the folder, and click the reload icon on the extension in
            chrome://extensions.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
