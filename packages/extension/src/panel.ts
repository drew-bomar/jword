import { captureKey, getJwordOrigin, originPattern } from "./settings";

/**
 * Side panel: embeds jword's /capture page and hands it the latest posting captured in this
 * browser window. The page asks with a "ready" message; we answer only that frame, only at the
 * configured jword origin. A new capture reloads the frame so the review starts fresh.
 */

interface CaptureEntry {
  id: string;
  payload: unknown;
}

const frame = document.querySelector("iframe")!;
const notice = document.querySelector<HTMLDivElement>("#notice")!;
let origin = "";
let entry: CaptureEntry | null = null;

function load() {
  frame.src = `${origin}/capture?embed=1${entry ? `&capture=${entry.id}` : ""}`;
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== origin) return;
  if (event.data?.type !== "jword:capture-ready" || !entry) return;
  frame.contentWindow!.postMessage(
    { type: "jword:capture-payload", payload: entry.payload },
    origin,
  );
});

async function main() {
  origin = await getJwordOrigin();
  if (!(await chrome.permissions.contains({ origins: [originPattern(origin)] }))) {
    frame.hidden = true;
    notice.hidden = false;
    document.querySelector("#open-options")!.addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
    });
    return;
  }
  const { id: windowId } = await chrome.windows.getCurrent();
  const key = captureKey(windowId!);
  entry = ((await chrome.storage.session.get(key))[key] as CaptureEntry | undefined) ?? null;
  load();
  chrome.storage.session.onChanged.addListener((changes) => {
    const next = changes[key]?.newValue as CaptureEntry | undefined;
    if (next && next.id !== entry?.id) {
      entry = next;
      load();
    }
  });
}

void main();
