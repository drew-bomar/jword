import { extractPosting } from "./extract/index";
import { installOverlayHost } from "./overlay-host";

/**
 * Injected into the job page only when the owner clicks the extension (activeTab).
 * It defines two functions the background worker then calls: one reads the posting as plain
 * data, the other draws the review overlay. Nothing runs on pages the owner did not ask to capture.
 */
(globalThis as { __jwordExtract?: () => unknown }).__jwordExtract = () =>
  extractPosting(document, location.href);
installOverlayHost();
