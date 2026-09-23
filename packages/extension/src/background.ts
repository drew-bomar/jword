import {
  normalizeCapturedPosting,
  type CapturedPosting,
  type CapturedPostingPayload,
} from "@jword/core/browser";
import { callJword } from "./api";
import {
  REMOVE_OVERLAY,
  isApiOp,
  type ApiResult,
  type OverlayCapture,
  type OverlayRequest,
} from "./messages";
import { captureKey, getJwordOrigin, originPattern } from "./settings";

/**
 * Flow (decision 017):
 * 1. The owner clicks the toolbar button on a job page. `activeTab` grants one-time access to
 *    that tab; no site is readable otherwise.
 * 2. We inject content.js, read the posting as plain data, and draw the overlay: an extension
 *    page (overlay.html) framed inside a closed shadow root, pinned right, pushing the page over.
 * 3. The overlay asks us for the posting and for every jword call. We check the message came
 *    from that tab's overlay frame with the capture's secret nonce, then call jword's
 *    /api/extension/* with the owner's session cookie (api.ts). The job page never sees jword
 *    data: the overlay frame is a different origin.
 */

interface CaptureEntry extends OverlayCapture {
  nonce: string;
}

type Global = typeof globalThis & {
  __jwordExtract?: () => unknown;
  __jwordShowOverlay?: (overlayUrl: string) => void;
};

function errorPayload(pageUrl: string, error: string): CapturedPostingPayload {
  return { version: 1, pageUrl, extractor: "none", error };
}

async function extractFrom(tabId: number, pageUrl: string): Promise<CapturedPostingPayload> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as Global).__jwordExtract?.(),
    });
    const payload = result?.result as CapturedPostingPayload | undefined;
    return payload ?? errorPayload(pageUrl, "Nothing could be read from this page.");
  } catch {
    return errorPayload(pageUrl, "Something went wrong while reading this page.");
  }
}

/**
 * The payload comes from third-party page markup, so it is validated here, where it enters the
 * extension, and fitted to jword's limits. The server validates the final command again.
 */
function toPosting(payload: CapturedPostingPayload, pageUrl: string): CapturedPosting {
  return (
    normalizeCapturedPosting(payload) ??
    normalizeCapturedPosting(errorPayload(pageUrl, "The posting could not be read."))!
  );
}

async function startCapture(tab: chrome.tabs.Tab) {
  const tabId = tab.id;
  const pageUrl = tab.url ?? "";
  if (!tabId || !/^https?:/.test(pageUrl)) return notReadable(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // Chrome pages, the Web Store, and PDFs cannot be scripted, so there is nowhere to draw.
    return notReadable(tabId);
  }
  await chrome.action.setBadgeText({ tabId, text: "" });
  const entry: CaptureEntry = {
    nonce: crypto.randomUUID(),
    posting: toPosting(await extractFrom(tabId, pageUrl), pageUrl),
    jwordUrl: await getJwordOrigin(),
  };
  await chrome.storage.session.set({ [captureKey(tabId)]: entry });
  // A new capture replaces an open overlay, e.g. after LinkedIn switched jobs without reloading.
  const overlayUrl = `${chrome.runtime.getURL("overlay.html")}#${entry.nonce}`;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (url: string) => (globalThis as Global).__jwordShowOverlay?.(url),
    args: [overlayUrl],
  });
}

async function notReadable(tabId: number | undefined) {
  if (!tabId) return;
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title: "jword can't read this page. Open a job posting." });
}

chrome.action.onClicked.addListener((tab) => void startCapture(tab));
// The browser test (tests/e2e/extension.spec.ts) cannot click the toolbar button, so it calls this.
(globalThis as { jwordStartCapture?: typeof startCapture }).jwordStartCapture = startCapture;

/** The tab whose overlay frame sent this message, or null for any other sender. */
function overlayTab(sender: chrome.runtime.MessageSender): number | null {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url) return null;
  const url = new URL(sender.url);
  return url.protocol === "chrome-extension:" && url.pathname === "/overlay.html"
    ? sender.tab.id
    : null;
}

const refused = (message: string): ApiResult => ({
  ok: false,
  error: { code: "FORBIDDEN", message },
});

async function handle(request: OverlayRequest, tabId: number): Promise<ApiResult> {
  const key = captureKey(tabId);
  const entry = (await chrome.storage.session.get(key))[key] as CaptureEntry | undefined;
  if (!entry || request.nonce !== entry.nonce) {
    return refused("This capture is out of date. Click the jword button again.");
  }
  switch (request.type) {
    case "jword:overlay-hello":
      return { ok: true, data: { posting: entry.posting, jwordUrl: entry.jwordUrl } };
    case "jword:api": {
      if (!isApiOp(request.op)) return refused("Unknown jword operation.");
      const allowed = await chrome.permissions.contains({
        origins: [originPattern(entry.jwordUrl)],
      });
      if (!allowed) {
        return refused(
          `jword capture is not allowed to reach ${entry.jwordUrl}. Save the address again in the extension options.`,
        );
      }
      return callJword(entry.jwordUrl, request.op, request.input);
    }
    case "jword:overlay-close":
      await chrome.storage.session.remove(key);
      await chrome.tabs.sendMessage(tabId, { type: REMOVE_OVERLAY }, { frameId: 0 });
      return { ok: true, data: null };
    case "jword:open-options":
      await chrome.runtime.openOptionsPage();
      return { ok: true, data: null };
    default:
      return refused("Unknown request.");
  }
}

chrome.runtime.onMessage.addListener((message: OverlayRequest, sender, sendResponse) => {
  const tabId = overlayTab(sender);
  if (tabId === null) return false;
  handle(message, tabId).then(sendResponse, () =>
    sendResponse(refused("The jword extension could not handle that request.")),
  );
  return true; // respond asynchronously
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(captureKey(tabId));
});
