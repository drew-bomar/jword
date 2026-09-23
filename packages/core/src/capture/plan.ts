import type { ApplicationDetail } from "../domain/types";

/**
 * Posting fields a capture may write to an existing application (decision 016).
 * Status, priority, dates the owner controls, company, and title are deliberately absent:
 * a capture describes the posting, not the owner's progress or the record's identity.
 */
export const CAPTURE_UPDATE_FIELDS = [
  "jobUrl",
  "externalJobId",
  "location",
  "workArrangement",
  "datePosted",
  "source",
  "description",
] as const;
export type CaptureUpdateField = (typeof CAPTURE_UPDATE_FIELDS)[number];

export type CaptureFieldValues = Record<CaptureUpdateField, string | null>;

/**
 * - `fill`: the record is blank here; selected by default.
 * - `overwrite`: the record already has a different value; never selected by default.
 * - `same`: nothing would change.
 * - `missing`: the capture has no value; a capture never clears a field.
 */
export type CaptureFieldChange = "fill" | "overwrite" | "same" | "missing";

export interface CaptureFieldPlan {
  field: CaptureUpdateField;
  current: string | null;
  captured: string | null;
  change: CaptureFieldChange;
  selectable: boolean;
  defaultSelected: boolean;
}

function currentValue(app: ApplicationDetail, field: CaptureUpdateField): string | null {
  if (field === "workArrangement") {
    return app.workArrangement === "UNKNOWN" ? null : app.workArrangement;
  }
  return app[field];
}

/** Compare as the owner would read it: whitespace differences are not changes. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

export function planCaptureUpdate(
  app: ApplicationDetail,
  captured: CaptureFieldValues,
): CaptureFieldPlan[] {
  return CAPTURE_UPDATE_FIELDS.map((field) => {
    const current = currentValue(app, field);
    const value = captured[field]?.trim() ? captured[field] : null;
    let change: CaptureFieldChange;
    if (value === null) change = "missing";
    else if (current === null) change = "fill";
    else if (sameText(current, value)) change = "same";
    else change = "overwrite";
    const selectable = change === "fill" || change === "overwrite";
    return {
      field,
      current,
      captured: value,
      change,
      selectable,
      defaultSelected: change === "fill",
    };
  });
}

/**
 * Build the `updateApplicationDetails` patch from the owner's explicit selection.
 * Only selectable fields the owner ticked are included; an empty patch means "nothing to save".
 */
export function buildCapturePatch(
  plan: CaptureFieldPlan[],
  selected: ReadonlySet<CaptureUpdateField>,
): Partial<Record<CaptureUpdateField, string>> {
  const patch: Partial<Record<CaptureUpdateField, string>> = {};
  for (const row of plan) {
    if (row.selectable && row.captured !== null && selected.has(row.field)) {
      patch[row.field] = row.captured;
    }
  }
  return patch;
}
