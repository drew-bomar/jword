import { extractPosting } from "./extract/index";

/**
 * Injected into the job page only when the owner clicks the extension (activeTab).
 * It defines a function; the background worker calls it in a second injection and receives
 * the plain-object result. Nothing runs on pages the owner did not ask to capture.
 */
(globalThis as { __jwordExtract?: () => unknown }).__jwordExtract = () =>
  extractPosting(document, location.href);
