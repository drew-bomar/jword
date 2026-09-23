"use client";

import { Button } from "@/components/ui/button";

/**
 * Sign-in prompt inside the extension side panel. Chrome does not keep cookies set inside a
 * frame on an extension page, so the owner signs in in a normal tab; the panel frame then sends
 * that session and continues to `next` with the posting.
 */
export function PanelSignIn({ next }: { next: string }) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Sign in to jword in a browser tab, then come back and continue. Your captured posting is
        kept.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a href="/sign-in" target="_blank" rel="noopener">
            Sign in in a new tab
          </a>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => window.location.assign(next)}
        >
          I&apos;ve signed in
        </Button>
      </div>
    </div>
  );
}
