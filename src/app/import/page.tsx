import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ImportWizard } from "@/features/import/import-wizard";
import { requirePageSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const session = await requirePageSession();
  return (
    <AppShell email={session.email}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Import from CSV</h1>
          <p className="text-muted-foreground text-sm">
            Export your sheet as CSV, map its columns, review every row, then confirm. Nothing is
            saved until you confirm, and the file itself is never stored.{" "}
            <a href="/jword-import-template.csv" download className="underline">
              Download the template
            </a>
            .
          </p>
        </div>
        <ImportWizard />
      </div>
    </AppShell>
  );
}
