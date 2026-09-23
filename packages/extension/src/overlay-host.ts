import { REMOVE_OVERLAY } from "./messages";

/**
 * Draws the capture overlay in the job page (decision 017). Runs in the extension's isolated
 * content-script world, only after the owner clicked the toolbar button.
 *
 * - The overlay itself is an extension page in an iframe. It is a different origin from the job
 *   page, so the page cannot read the jword data shown in it.
 * - The iframe sits in a *closed* shadow root: page scripts cannot reach it or read its URL
 *   (which carries the capture nonce), and page CSS cannot restyle it.
 * - The page is narrowed so the panel sits beside it rather than over it, like a side panel.
 */

export const PANEL_WIDTH = 420;
/** Below this viewport width the panel covers the page instead of squeezing it. */
const PUSH_MIN_VIEWPORT = 900;
const HOST_TAG = "jword-capture-overlay";

/** Quick slide in from the right edge; skipped when the owner prefers reduced motion. */
const SLIDE_MS = 200;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";

interface Overlay {
  host: HTMLElement;
  frame: HTMLIFrameElement;
  restoreWidth: (ms: number) => void;
}

type Global = typeof globalThis & {
  __jwordOverlay?: Overlay | null;
  __jwordShowOverlay?: (overlayUrl: string) => void;
  __jwordOverlayListening?: boolean;
};
const g = globalThis as Global;

function important(el: HTMLElement, styles: Record<string, string>) {
  for (const [name, value] of Object.entries(styles))
    el.style.setProperty(name, value, "important");
}

function slideMs(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : SLIDE_MS;
}

/** Commit the current styles so the next change animates from them. */
const reflow = (el: HTMLElement) => void el.getBoundingClientRect();

/** Narrow the page to make room (animated); returns how to undo it. */
function pushPage(ms: number): Overlay["restoreWidth"] {
  const html = document.documentElement;
  if (window.innerWidth < PUSH_MIN_VIEWPORT) return () => {};
  const saved = (name: string) => ({
    value: html.style.getPropertyValue(name),
    priority: html.style.getPropertyPriority(name),
  });
  const before = { width: saved("width"), transition: saved("transition") };
  const put = (name: "width" | "transition", value: string | null) => {
    if (value !== null) return html.style.setProperty(name, value, "important");
    const { value: old, priority } = before[name];
    if (old) html.style.setProperty(name, old, priority);
    else html.style.removeProperty(name);
  };
  // Width only animates between explicit values, so start from 100%.
  put("transition", "none");
  put("width", "100%");
  reflow(html);
  put("transition", ms ? `width ${ms}ms ${EASE}` : "none");
  put("width", `calc(100% - ${PANEL_WIDTH}px)`);
  const settle = setTimeout(() => put("transition", null), ms);
  return (closeMs) => {
    clearTimeout(settle);
    put("transition", closeMs ? `width ${closeMs}ms ${EASE}` : "none");
    put("width", "100%");
    setTimeout(() => {
      put("transition", null);
      put("width", null);
    }, closeMs);
  };
}

export function showOverlay(overlayUrl: string) {
  const existing = g.__jwordOverlay;
  if (existing?.host.isConnected) {
    existing.frame.src = overlayUrl;
    return;
  }
  const ms = slideMs();
  const host = document.createElement(HOST_TAG);
  important(host, {
    all: "initial",
    position: "fixed",
    top: "0",
    right: "0",
    width: `min(${PANEL_WIDTH}px, 100vw)`,
    height: "100vh",
    "z-index": "2147483647",
    display: "block",
    transform: "translateX(100%)",
    transition: ms ? `transform ${ms}ms ${EASE}` : "none",
  });
  const root = host.attachShadow({ mode: "closed" });
  const frame = document.createElement("iframe");
  frame.title = "jword capture";
  frame.src = overlayUrl;
  important(frame, {
    border: "0",
    "border-left": "1px solid #e5e5e5",
    "box-shadow": "-4px 0 16px rgb(0 0 0 / 0.08)",
    display: "block",
    width: "100%",
    height: "100%",
    background: "#fff",
    "color-scheme": "light",
  });
  root.append(frame);
  document.documentElement.append(host);
  reflow(host);
  important(host, { transform: "translateX(0)" });
  g.__jwordOverlay = { host, frame, restoreWidth: pushPage(ms) };
}

/** Slide the panel out, give the page its width back, then remove the panel. */
export function removeOverlay() {
  const overlay = g.__jwordOverlay;
  if (!overlay) return;
  g.__jwordOverlay = null;
  const ms = slideMs();
  important(overlay.host, {
    transform: "translateX(100%)",
    transition: ms ? `transform ${ms}ms ${EASE}` : "none",
  });
  overlay.restoreWidth(ms);
  setTimeout(() => overlay.host.remove(), ms);
}

export function installOverlayHost() {
  g.__jwordShowOverlay = showOverlay;
  if (g.__jwordOverlayListening) return;
  g.__jwordOverlayListening = true;
  // Only the background worker can send runtime messages to this content script.
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === REMOVE_OVERLAY) removeOverlay();
  });
}
