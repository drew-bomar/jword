/**
 * Conservative name normalization (decision 013). Mirrors jword.normalize_name() in SQL:
 * trim, collapse whitespace runs to one space, lowercase. Punctuation and suffixes stay.
 */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trimmed string, or null when blank. Mirrors jword.clean_text() in SQL. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
