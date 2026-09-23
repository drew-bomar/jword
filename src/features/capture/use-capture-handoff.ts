"use client";

import { useEffect, useState } from "react";
import { normalizeCapturedPosting, type CapturedPosting } from "@jword/core/browser";

export const CAPTURE_READY = "jword:capture-ready";
export const CAPTURE_PAYLOAD = "jword:capture-payload";

export type HandoffState =
  { phase: "waiting" } | { phase: "missing" } | { phase: "received"; posting: CapturedPosting };

/**
 * Receive the posting from the jword extension.
 *
 * In the extension's side panel this page is framed by a `chrome-extension://` page, so it asks
 * its parent with a "ready" message (which carries no data) and accepts the reply only from that
 * parent at an extension origin. The /capture route only allows extension pages to frame it
 * (next.config.ts). A same-window message is also accepted; the Playwright capture specs use it
 * to stand in for the extension. Either way the values are untrusted prefill: the owner reviews
 * them and the server validates the final command again.
 *
 * After `timeoutMs` the page explains how to use it, but a late posting is still accepted.
 */
export function useCaptureHandoff(timeoutMs = 4000): HandoffState {
  const [state, setState] = useState<HandoffState>({ phase: "waiting" });

  useEffect(() => {
    let received = false;
    const origin = window.location.origin;
    const embedded = window.parent !== window;
    const ping = () => {
      if (embedded) window.parent.postMessage({ type: CAPTURE_READY }, "*");
      else window.postMessage({ type: CAPTURE_READY }, origin);
    };

    function trusted(event: MessageEvent): boolean {
      if (embedded) {
        return event.source === window.parent && event.origin.startsWith("chrome-extension://");
      }
      return event.source === window && event.origin === origin;
    }

    function onMessage(event: MessageEvent) {
      if (received || !trusted(event) || event.data?.type !== CAPTURE_PAYLOAD) return;
      const posting = normalizeCapturedPosting(event.data.payload);
      if (!posting) return;
      received = true;
      clearInterval(interval);
      setState({ phase: "received", posting });
    }

    window.addEventListener("message", onMessage);
    const interval = setInterval(ping, 400);
    const timeout = setTimeout(() => {
      if (!received) setState({ phase: "missing" });
    }, timeoutMs);
    ping();
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [timeoutMs]);

  return state;
}
