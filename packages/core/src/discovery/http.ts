/**
 * HTTP rules shared by board discovery (decision 019) and job collection (decision 024):
 * redirects are refused so requests stay on the provider host that was built from a validated
 * identifier, bodies are read up to a byte limit and never buffered whole, and only HTTP 404
 * means "missing". Callers supply the timeout through `signal`.
 */

export type Fetch = typeof fetch;

const USER_AGENT = "jword/0.1 (personal job tracker; board lookup)";

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Read at most `limit` bytes of a response body; longer bodies are cut, never buffered whole. */
export async function readText(
  response: Response,
  limit: number,
): Promise<{ text: string; cut: boolean }> {
  if (!response.body) return { text: "", cut: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= limit) {
      cut = true;
      await reader.cancel();
      break;
    }
  }
  const joined = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, joined.length - offset));
    joined.set(part, offset);
    offset += part.length;
  }
  return { text: new TextDecoder().decode(joined), cut };
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, code: string) => {
      const point = code[0]!.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export class ResponseTooLargeError extends Error {
  constructor() {
    super("response too large");
  }
}

export function createProviderHttp(options: { fetch?: Fetch } = {}) {
  const doFetch: Fetch = options.fetch ?? ((...args) => fetch(...args));

  async function request(url: string, signal: AbortSignal, init: RequestInit, limit: number) {
    const response = await doFetch(url, {
      ...init,
      redirect: "error",
      signal,
      cache: "no-store",
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/html", ...init.headers },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return { missing: true as const };
      throw new HttpStatusError(response.status);
    }
    return { missing: false as const, ...(await readText(response, limit)) };
  }

  /** Parsed JSON, or undefined for 404. A body over `limit` bytes throws ResponseTooLargeError. */
  async function json(
    url: string,
    signal: AbortSignal,
    init: RequestInit,
    limit: number,
  ): Promise<unknown | undefined> {
    const result = await request(url, signal, init, limit);
    if (result.missing) return undefined;
    if (result.cut) throw new ResponseTooLargeError();
    return JSON.parse(result.text) as unknown;
  }

  return { request, json };
}
