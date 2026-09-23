import type { Metadata } from "next";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const linkError = params.error === "link";
  const next = typeof params.next === "string" ? params.next : null;
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
