import type { WorkArrangement } from "@jword/core/browser";

const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON"]);

function spacedText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const tag = (node as Element).tagName.toUpperCase();
  if (SKIP_INLINE.has(tag)) return "";
  const inner = Array.from(node.childNodes).map(spacedText).join("");
  // Adjacent buttons/blocks often have no whitespace between them ("Remote" + "Full-time");
  // inline elements such as <span> or <strong> are joined as-is so words are not split.
  return BLOCK.has(tag) || tag === "BUTTON" ? ` ${inner} ` : inner;
}
const SKIP_INLINE = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);

/** Single-line visible text of the first matching element. */
export function textOf(root: ParentNode, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = el ? spacedText(el).replace(/\s+/g, " ").trim() : "";
    if (text) return text;
  }
  return null;
}

/** Content of a <meta> tag by property or name. */
export function metaContent(doc: Document, key: string): string | null {
  const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
  return el?.getAttribute("content")?.trim() || null;
}

/**
 * Readable multi-line text from an element: block elements become line breaks and list items
 * get a bullet, so a pasted description keeps its structure. Scripts and buttons are skipped.
 */
export function elementToText(root: Node): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const block = BLOCK.has(tag);
    if (block) out.push("\n");
    if (tag === "LI") out.push("• ");
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) out.push("\n");
  };
  walk(root);
  return out
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First matching elements' combined readable text. */
export function blockText(root: ParentNode, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    const nodes = Array.from(root.querySelectorAll(selector));
    const text = nodes.map(elementToText).filter(Boolean).join("\n\n").trim();
    if (text) return text;
  }
  return null;
}

/**
 * Convert an HTML string (e.g. a JSON-LD description) to text. Parsing with DOMParser does not
 * run scripts or load resources. Some sites double-escape the HTML, so decode once more when the
 * first pass still looks like markup.
 */
export function htmlToText(html: string, doc: Document): string {
  const parse = (value: string) => {
    const Parser = doc.defaultView?.DOMParser ?? DOMParser;
    return new Parser().parseFromString(value, "text/html").body;
  };
  let body = parse(html);
  if (/<\/?[a-z][^>]*>/i.test(body.textContent ?? "") && !body.children.length) {
    body = parse(body.textContent ?? "");
  }
  return elementToText(body);
}

/**
 * Work arrangement from a short label such as a location or workplace-type pill.
 * Never applied to full descriptions, where words like "remote" appear incidentally.
 */
export function arrangementFrom(text: string | null | undefined): WorkArrangement | null {
  if (!text) return null;
  if (/\bhybrid\b/i.test(text)) return "HYBRID";
  if (/\bremote\b|\btelecommute\b|work from home/i.test(text)) return "REMOTE";
  if (/\bon[- ]?site\b|\bin[- ]office\b|\bin[- ]person\b/i.test(text)) return "ONSITE";
  return null;
}

/** "acme-robotics" -> "Acme Robotics". Only used as a flagged guess. */
export function titleFromSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  const words = decodeURIComponent(slug)
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (!words.length) return null;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}
