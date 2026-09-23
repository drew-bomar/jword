import type { CapturedPostingPayload } from "@jword/core/browser";
import { captureKey } from "./settings";

/**
 * Flow (decision 016):
 * 1. Owner clicks the toolbar button on a job page. `activeTab` grants one-time access to it,
 *    and the click opens Chrome's side panel for this window.
 * 2. We inject the extractor and read the posting as plain data.
 * 3. We store the posting in session storage for this window. The side panel (panel.ts) embeds
 *    jword's /capture page and hands it the posting; saving uses jword's normal Server Actions.
 *    The extension never talks to jword's server.
 */

function errorPayload(pageUrl: string, error: string): CapturedPostingPayload {
  return { version: 1, pageUrl, extractor: "none", error };
}

async function extractFrom(tab: chrome.tabs.Tab): Promise<CapturedPostingPayload> {
  const pageUrl = tab.url ?? "";
  if (!tab.id || !/^https?:/.test(pageUrl)) {
    return errorPayload(pageUrl, "This page can't be read. Open a job posting and try again.");
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as { __jwordExtract?: () => unknown }).__jwordExtract?.(),
    });
    const payload = result?.result as CapturedPostingPayload | undefined;
    return payload ?? errorPayload(pageUrl, "Nothing could be read from this page.");
  } catch {
    return errorPayload(pageUrl, "Chrome did not allow reading this page.");
  }
}

async function startCapture(tab: chrome.tabs.Tab) {
  // Must run first, while the click still counts as a user gesture.
  const opening = chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  const payload = await extractFrom(tab);
  // A new capture id makes an already-open panel reload with the new posting.
  await chrome.storage.session.set({
    [captureKey(tab.windowId)]: { id: crypto.randomUUID(), payload },
  });
  await opening;
}

chrome.action.onClicked.addListener(startCapture);
// The browser test (tests/e2e/extension.spec.ts) cannot click the toolbar button, so it calls this.
(globalThis as { jwordStartCapture?: typeof startCapture }).jwordStartCapture = startCapture;

chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.session.remove(captureKey(windowId));
});
