"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Route-level failure state: shown when a page's data could not be loaded. Never exposes internals. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4 text-center" role="alert">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          The page could not be loaded. Nothing was changed. Try again, or go back to the
          applications list.
        </p>
        <div className="flex justify-center gap-2">
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Applications</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
