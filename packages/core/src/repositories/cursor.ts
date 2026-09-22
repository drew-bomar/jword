import { JwordError } from "../domain/errors";

interface CursorPayload {
  o: number;
  h: string;
}

/** Stable, opaque offset cursor bound to the filter set it was issued for. */
export function encodeCursor(offset: number, filterKey: string): string {
  const payload: CursorPayload = { o: offset, h: filterKey };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined, filterKey: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    if (typeof parsed.o !== "number" || parsed.o < 0 || parsed.h !== filterKey) {
      throw new Error("mismatch");
    }
    return parsed.o;
  } catch {
    throw new JwordError("VALIDATION_ERROR", "Cursor is invalid or does not match these filters.", {
      fieldErrors: { cursor: ["Cursor is invalid or does not match these filters."] },
    });
  }
}

export function filterKeyFor(value: unknown): string {
  const json = JSON.stringify(value, Object.keys((value as object) ?? {}).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
