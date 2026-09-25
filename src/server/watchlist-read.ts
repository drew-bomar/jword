import { runAction } from "./actions/result";
import { requireSession, type WebSession } from "./auth/session";
import { httpStatusFor } from "./extension-origin";

export type ReadInput = Record<string, string | string[]>;

/** Query parameters as service input; a repeated key becomes a list. Schemas validate the rest. */
function readInput(params: URLSearchParams): ReadInput {
  const input: ReadInput = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    input[key] = values.length > 1 ? values : values[0]!;
  }
  return input;
}

/** Narrow, authenticated reads. Mutations continue to use Server Actions. */
export function watchlistRead<T>(
  handle: (session: WebSession, input: ReadInput, signal: AbortSignal) => Promise<T>,
) {
  return async function GET(request: Request): Promise<Response> {
    const result = await runAction(async () => {
      const session = await requireSession();
      return handle(session, readInput(new URL(request.url).searchParams), request.signal);
    }, "watchlist-read");
    return Response.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: { "Cache-Control": "private, no-store" },
    });
  };
}
