import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "../validation/schemas";
import { JwordError } from "../domain/errors";

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header excluded). Ragged rows are padded/truncated to the header length. */
  rows: string[][];
  /** Rows that were entirely blank and dropped. */
  blankRowsSkipped: number;
}

/**
 * Small RFC 4180 parser: quoted fields, doubled quotes, embedded newlines, CRLF, BOM.
 * Runs in the browser (preview) and on the server (never persists the file).
 */
export function parseCsv(text: string): ParsedCsv {
  if (text.length > IMPORT_MAX_BYTES) {
    throw new JwordError(
      "VALIDATION_ERROR",
      `CSV is too large. The limit is ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.`,
    );
  }
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      field = "";
      record = [];
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) {
    throw new JwordError("VALIDATION_ERROR", "CSV has an unterminated quoted field.");
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const headerRecord = records.shift();
  if (!headerRecord || headerRecord.every((h) => h.trim() === "")) {
    throw new JwordError("VALIDATION_ERROR", "CSV has no header row.");
  }
  const headers = headerRecord.map((h, index) => (h.trim() === "" ? `Column ${index + 1}` : h.trim()));

  let blankRowsSkipped = 0;
  const rows: string[][] = [];
  for (const rec of records) {
    if (rec.every((cell) => cell.trim() === "")) {
      blankRowsSkipped += 1;
      continue;
    }
    const padded = headers.map((_, index) => rec[index] ?? "");
    rows.push(padded);
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new JwordError(
      "VALIDATION_ERROR",
      `CSV has ${rows.length} data rows. The limit is ${IMPORT_MAX_ROWS} per import.`,
    );
  }
  return { headers, rows, blankRowsSkipped };
}
