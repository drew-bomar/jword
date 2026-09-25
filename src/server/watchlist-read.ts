import { runAction } from "./actions/result";
import { requireSession, type WebSession } from "./auth/session";
import { httpStatusFor } from "./extension-origin";

/** Narrow, authenticated reads. Mutations continue to use Server Actions. */
export function watchlistRead<T>(
  handle: (session: WebSession, input: Record<string, string>, signal: AbortSignal) => Promise<T>,
) {
  return async function GET(request: Request): Promise<Response> {
    const result = await runAction(async () => {
      const session = await requireSession();
      return handle(session, Object.fromEntries(new URL(request.url).searchParams), request.signal);
    }, "watchlist-read");
    return Response.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: { "Cache-Control": "private, no-store" },
    });
  };
}
