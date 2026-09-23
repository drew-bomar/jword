import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { XIcon } from "lucide-react";
import type { CapturedPosting } from "@jword/core/browser";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CaptureReview } from "@/features/capture/capture-review";
import type { OverlayCapture } from "../messages";
import { ask, backgroundApi } from "./client";

/**
 * The in-page capture overlay (decision 017): an extension page framed into the job tab by
 * overlay-host.ts. The URL fragment carries the capture's nonce; the background worker only
 * answers this frame when it matches.
 */

type State =
  | { phase: "loading" }
  | { phase: "failed"; message: string }
  | { phase: "ready"; posting: CapturedPosting; jwordUrl: string };

const nonce = location.hash.slice(1);

function Overlay() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const api = useMemo(() => backgroundApi(nonce), []);

  useEffect(() => {
    ask<OverlayCapture>({ type: "jword:overlay-hello", nonce }).then(
      (result) => {
        if (!result.ok) return setState({ phase: "failed", message: result.error.message });
        setState({ phase: "ready", posting: result.data.posting, jwordUrl: result.data.jwordUrl });
      },
      () => setState({ phase: "failed", message: "The jword extension did not answer." }),
    );
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">Capture job</h1>
        <div className="flex items-center gap-1">
          {state.phase === "ready" ? (
            <a
              href={state.jwordUrl}
              target="_blank"
              rel="noopener"
              className="text-muted-foreground px-2 text-xs font-semibold tracking-tight"
            >
              jword ↗
            </a>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close jword capture"
            onClick={() => void ask({ type: "jword:overlay-close", nonce }).catch(() => {})}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {state.phase === "loading" ? (
          <p className="text-muted-foreground text-sm">Reading the posting…</p>
        ) : state.phase === "failed" ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Review what was read from the posting, then add it or update an application you
              already track. Nothing is saved until you confirm.
            </p>
            <CaptureReview posting={state.posting} api={api} jwordUrl={state.jwordUrl} />
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
