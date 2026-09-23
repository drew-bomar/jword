import { API_ENDPOINTS, MUTATION_OPS, type ApiOp, type ApiResult } from "./messages";

/**
 * The background worker's call to jword (decision 017). It runs with the extension's host
 * permission for the jword origin, so Chrome attaches the owner's normal jword session cookie and
 * sends `Origin: chrome-extension://<id>`, which the server checks. The response body is jword's
 * ActionResult either way; HTTP status is informational.
 */
export async function callJword(
  jwordUrl: string,
  op: ApiOp,
  input: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${jwordUrl}/api/extension/${API_ENDPOINTS[op]}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? null),
      // The API answers signed-out calls with 401 itself; a redirect means a wrong address.
      redirect: "error",
    });
  } catch {
    return unreachable(jwordUrl, op);
  }
  const body: unknown = await response.json().catch(() => null);
  if (isResult(body)) return body;
  return unreachable(jwordUrl, op, response.status);
}

function unreachable(jwordUrl: string, op: ApiOp, status?: number): ApiResult {
  const what = status ? `jword at ${jwordUrl} answered unexpectedly (HTTP ${status}).` : null;
  if (MUTATION_OPS.has(op)) {
    // The request may have reached jword and saved. Keep the command for an identical retry.
    return {
      ok: false,
      error: {
        code: "OUTCOME_UNKNOWN",
        message: `${what ?? `jword at ${jwordUrl} did not answer.`} The save is unconfirmed; retry the original save.`,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: what ?? `Could not reach jword at ${jwordUrl}. Check that it is running.`,
    },
  };
}

function isResult(value: unknown): value is ApiResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === true) return "data" in value;
  if (value.ok !== false || !("error" in value)) return false;
  const error = value.error as { code?: unknown; message?: unknown } | null;
  return typeof error?.code === "string" && typeof error.message === "string";
}
