import { serverEnv } from "@/lib/env";
import { runAction, type ActionResult } from "@/server/actions/result";
import { requireSession, type WebSession } from "@/server/auth/session";
import { checkExtensionRequest, httpStatusFor } from "@/server/extension-origin";

/**
 * Wraps one capture-extension endpoint (decision 017). Order matters: the extension origin is
 * checked before the session, so a request from any website is refused without touching it.
 * Then the same path as a Server Action: requireSession (including the owner lock), the handler
 * calling one shared service, and a serializable `ActionResult` body. No business rules here.
 */
export function extensionEndpoint<T>(
  handle: (session: WebSession, input: unknown) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request) {
    const refused = checkExtensionRequest(request.headers, serverEnv().extensionId);
    if (refused)
      return reply({ ok: false, error: { code: refused.code, message: refused.message } });

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return reply({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "The request body is not valid JSON." },
      });
    }
    return reply(
      await runAction(async () => handle(await requireSession(), input), "extension-api"),
    );
  };
}

function reply<T>(result: ActionResult<T>): Response {
  return Response.json(result, {
    status: result.ok ? 200 : httpStatusFor(result.error.code),
    // Owner data: never cache. No CORS headers: only the extension (host permission) may read it.
    headers: { "Cache-Control": "private, no-store" },
  });
}
