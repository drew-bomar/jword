import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  WORK_ARRANGEMENTS,
  type ApplicationPriority,
  type ApplicationStatus,
  type WorkArrangement,
} from "../domain/enums";
import { isIsoDate } from "../domain/dates";
import { cleanText, normalizeName } from "../domain/normalize";
import type { DuplicateCandidate } from "../domain/errors";
import { importRowSchema, type ImportRowCommand } from "../validation/schemas";
import { IMPORT_FIELDS, type ImportField, type RawImportRow } from "./mapping";

export interface RowIssue {
  field: ImportField | "row";
  message: string;
}

export interface ImportRowPreview {
  /** 1-based data row number (header excluded). */
  rowIndex: number;
  raw: RawImportRow;
  /** Fully validated values when the row has no errors. */
  values: Omit<ImportRowCommand, "duplicateChoice"> | null;
  errors: RowIssue[];
  warnings: RowIssue[];
  /** Existing applications this row likely duplicates. */
  duplicates: DuplicateCandidate[];
  /** Earlier row numbers in the same upload this row likely duplicates. */
  duplicateOfRows: number[];
}

// ---------------------------------------------------------------------------
// Cell parsers: explicit, no silent coercion of unknown values.
// ---------------------------------------------------------------------------

const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  ONLINE_ASSESSMENT: "OA",
  ASSESSMENT: "OA",
  INTERVIEWING: "INTERVIEW",
  FINAL_ROUND: "FINAL",
  READY: "READY_TO_APPLY",
  REJECT: "REJECTED",
  WITHDREW: "WITHDRAWN",
};

const ARRANGEMENT_ALIASES: Record<string, WorkArrangement> = {
  ON_SITE: "ONSITE",
  IN_OFFICE: "ONSITE",
  IN_PERSON: "ONSITE",
  OFFICE: "ONSITE",
  WFH: "REMOTE",
};

function keyOf(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, "_");
}

export function parseStatusCell(value: string | undefined): {
  value?: ApplicationStatus;
  error?: string;
} {
  const text = cleanText(value);
  if (text === null) return {};
  const key = keyOf(text);
  const resolved = (APPLICATION_STATUSES as readonly string[]).includes(key)
    ? (key as ApplicationStatus)
    : STATUS_ALIASES[key];
  if (!resolved) return { error: `Unknown status "${text}".` };
  return { value: resolved };
}

export function parsePriorityCell(value: string | undefined): {
  value?: ApplicationPriority;
  error?: string;
} {
  const text = cleanText(value);
  if (text === null) return {};
  const key = keyOf(text);
  if ((APPLICATION_PRIORITIES as readonly string[]).includes(key))
    return { value: key as ApplicationPriority };
  return { error: `Unknown priority "${text}".` };
}

export function parseArrangementCell(value: string | undefined): {
  value?: WorkArrangement;
  error?: string;
} {
  const text = cleanText(value);
  if (text === null) return {};
  const key = keyOf(text);
  const resolved = (WORK_ARRANGEMENTS as readonly string[]).includes(key)
    ? (key as WorkArrangement)
    : ARRANGEMENT_ALIASES[key];
  if (!resolved) return { error: `Unknown work arrangement "${text}".` };
  return { value: resolved };
}

/**
 * Accepts ISO (YYYY-MM-DD) and US slash dates (M/D/YYYY or M/D/YY, as Google Sheets exports).
 * Anything else is an error the user must fix; nothing is guessed.
 */
export function parseDateCell(value: string | undefined): {
  value?: string | null;
  error?: string;
} {
  const text = cleanText(value);
  if (text === null) return { value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return isIsoDate(text) ? { value: text } : { error: `"${text}" is not a valid calendar date.` };
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const [, m, d, yRaw] = slash;
    const year = yRaw!.length === 2 ? `20${yRaw}` : yRaw!;
    const iso = `${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    return isIsoDate(iso) ? { value: iso } : { error: `"${text}" is not a valid calendar date.` };
  }
  return { error: `"${text}" is not a recognized date. Use YYYY-MM-DD or M/D/YYYY.` };
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export function validateImportRow(rowIndex: number, raw: RawImportRow): ImportRowPreview {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const candidate: Record<string, unknown> = { rowIndex };

  const company = cleanText(raw.company);
  const title = cleanText(raw.title);
  if (!company) errors.push({ field: "company", message: "Company is required." });
  if (!title) errors.push({ field: "title", message: "Job title is required." });
  candidate.company = company ?? "";
  candidate.title = title ?? "";

  const status = parseStatusCell(raw.status);
  if (status.error) errors.push({ field: "status", message: status.error });
  else if (status.value) candidate.status = status.value;

  const priority = parsePriorityCell(raw.priority);
  if (priority.error) errors.push({ field: "priority", message: priority.error });
  else if (priority.value) candidate.priority = priority.value;

  const arrangement = parseArrangementCell(raw.workArrangement);
  if (arrangement.error) errors.push({ field: "workArrangement", message: arrangement.error });
  else if (arrangement.value) candidate.workArrangement = arrangement.value;

  for (const field of ["datePosted", "dateFound", "appliedAt"] as const) {
    if (raw[field] === undefined) continue;
    const parsed = parseDateCell(raw[field]);
    if (parsed.error) errors.push({ field, message: parsed.error });
    else candidate[field] = parsed.value ?? null;
  }

  const jobUrl = cleanText(raw.jobUrl);
  if (jobUrl !== null) {
    if (/^https?:\/\/\S+$/i.test(jobUrl)) candidate.jobUrl = jobUrl;
    else errors.push({ field: "jobUrl", message: "Job URL must start with http:// or https://." });
  } else if (raw.jobUrl !== undefined) {
    candidate.jobUrl = null;
  }

  for (const field of [
    "externalJobId",
    "location",
    "source",
    "resumeVersion",
    "referral",
    "note",
  ] as const) {
    if (raw[field] === undefined) continue;
    const text =
      field === "note" ? (raw[field]?.trim() ? raw[field] : null) : cleanText(raw[field]);
    candidate[field] = text ?? null;
  }

  // Shared schema is the final word (lengths, URL shape, enum values).
  const parsed = importRowSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = (issue.path[0] as ImportField | undefined) ?? "row";
      if (!errors.some((e) => e.field === field && e.message === issue.message)) {
        errors.push({
          field: IMPORT_FIELDS.includes(field as ImportField) ? field : "row",
          message: issue.message,
        });
      }
    }
  }

  if (
    candidate.status === "APPLIED" &&
    (candidate.appliedAt === null || candidate.appliedAt === undefined)
  ) {
    warnings.push({
      field: "appliedAt",
      message: "Status is APPLIED but no applied date; it will stay blank.",
    });
  }

  return {
    rowIndex,
    raw,
    values: errors.length === 0 && parsed.success ? parsed.data : null,
    errors,
    warnings,
    duplicates: [],
    duplicateOfRows: [],
  };
}

// ---------------------------------------------------------------------------
// Duplicate detection (decision 006): warnings, never merges.
// ---------------------------------------------------------------------------

export interface DuplicateIndexEntry {
  applicationId: string;
  company: string;
  normalizedCompany: string;
  title: string;
  normalizedTitle: string;
  jobUrl: string | null;
  externalJobId: string | null;
  status: ApplicationStatus;
}

export interface DuplicateProbe {
  normalizedCompany: string;
  normalizedTitle: string;
  jobUrl: string | null;
  externalJobId: string | null;
}

export function matchDuplicate(probe: DuplicateProbe, entry: DuplicateIndexEntry): string[] {
  const matchedOn: string[] = [];
  if (
    entry.normalizedCompany === probe.normalizedCompany &&
    entry.normalizedTitle === probe.normalizedTitle
  ) {
    matchedOn.push("company_title");
  }
  if (probe.jobUrl && entry.jobUrl === probe.jobUrl) matchedOn.push("job_url");
  if (
    probe.externalJobId &&
    entry.externalJobId === probe.externalJobId &&
    entry.normalizedCompany === probe.normalizedCompany
  ) {
    matchedOn.push("external_job_id");
  }
  return matchedOn;
}

export function findDuplicateCandidates(
  probe: DuplicateProbe,
  index: DuplicateIndexEntry[],
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const entry of index) {
    const matchedOn = matchDuplicate(probe, entry);
    if (matchedOn.length) {
      out.push({
        applicationId: entry.applicationId,
        company: entry.company,
        title: entry.title,
        status: entry.status,
        matchedOn,
      });
    }
    if (out.length >= 5) break;
  }
  return out;
}

export function probeForRow(values: {
  company: string;
  title: string;
  jobUrl?: string | null;
  externalJobId?: string | null;
}): DuplicateProbe {
  return {
    normalizedCompany: normalizeName(values.company),
    normalizedTitle: normalizeName(values.title),
    jobUrl: values.jobUrl ?? null,
    externalJobId: values.externalJobId ?? null,
  };
}

/** Annotate previews with duplicates against existing records and earlier rows in the upload. */
export function annotateDuplicates(
  previews: ImportRowPreview[],
  existing: DuplicateIndexEntry[],
): ImportRowPreview[] {
  const seen: Array<{ rowIndex: number; probe: DuplicateProbe }> = [];
  return previews.map((preview) => {
    if (!preview.values) return preview;
    const probe = probeForRow(preview.values);
    const duplicates = findDuplicateCandidates(probe, existing);
    const duplicateOfRows = seen
      .filter((earlier) => {
        const entry: DuplicateIndexEntry = {
          applicationId: "",
          company: "",
          normalizedCompany: earlier.probe.normalizedCompany,
          title: "",
          normalizedTitle: earlier.probe.normalizedTitle,
          jobUrl: earlier.probe.jobUrl,
          externalJobId: earlier.probe.externalJobId,
          status: "SAVED",
        };
        return matchDuplicate(probe, entry).length > 0;
      })
      .map((earlier) => earlier.rowIndex);
    seen.push({ rowIndex: preview.rowIndex, probe });
    return { ...preview, duplicates, duplicateOfRows };
  });
}

export function isFlagged(preview: ImportRowPreview): boolean {
  return preview.duplicates.length > 0 || preview.duplicateOfRows.length > 0;
}
