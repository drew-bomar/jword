import type { Metadata } from "next";
import { PanelSignIn } from "@/features/auth/panel-sign-in";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const linkError = params.error === "link";
  const next = typeof params.next === "string" ? params.next : null;
  // Opened inside the extension side panel (a /capture?embed=1 frame): see PanelSignIn.
  const inPanel =
    next !== null &&
    next.startsWith("/capture?") &&
    new URLSearchParams(next.slice("/capture?".length)).get("embed") === "1";
  if (inPanel) {
    return (
      <main className="space-y-4 px-4 py-4">
        <h1 className="text-base font-semibold tracking-tight">Sign in to jword</h1>
        <PanelSignIn next={next} />
      </main>
    );
  }
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to jword</h1>
          <p className="text-muted-foreground text-sm">
            Enter the owner email. You will receive a one-time code and a magic link.
          </p>
        </div>
        <SignInForm
          next={next}
          initialError={
            linkError ? "That sign-in link is invalid or expired. Request a new one." : null
          }
        />
      </div>
    </main>
  );
}
