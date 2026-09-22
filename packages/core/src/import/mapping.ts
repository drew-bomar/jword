export const IMPORT_FIELDS = [
  "company",
  "title",
  "status",
  "priority",
  "jobUrl",
  "externalJobId",
  "location",
  "workArrangement",
  "datePosted",
  "dateFound",
  "appliedAt",
  "source",
  "resumeVersion",
  "referral",
  "note",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["company", "title"];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  company: "Company",
  title: "Job title",
  status: "Status",
  priority: "Priority",
  jobUrl: "Job URL",
  externalJobId: "External job ID",
  location: "Location",
  workArrangement: "Work arrangement",
  datePosted: "Date posted",
  dateFound: "Date found",
  appliedAt: "Date applied",
  source: "Source",
  resumeVersion: "Resume version",
  referral: "Referral",
  note: "Notes",
};

/** jword field -> source column index (null = not imported). */
export type ImportMapping = Record<ImportField, number | null>;

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  company: ["company", "employer", "organization", "org", "company name"],
  title: ["title", "role", "position", "job title", "job", "role title"],
  status: ["status", "stage", "state"],
  priority: ["priority", "interest"],
  jobUrl: ["url", "link", "job url", "job link", "posting", "posting url", "application link"],
  externalJobId: [
    "job id",
    "req id",
    "requisition",
    "requisition id",
    "external id",
    "external job id",
  ],
  location: ["location", "city", "office"],
  workArrangement: [
    "arrangement",
    "work arrangement",
    "work type",
    "remote",
    "onsite",
    "remote/hybrid",
  ],
  datePosted: ["date posted", "posted", "posted on"],
  dateFound: ["date found", "found", "saved", "date saved", "added", "date added"],
  appliedAt: ["date applied", "applied", "applied date", "applied on", "application date"],
  source: ["source", "found via", "board", "platform", "site"],
  resumeVersion: ["resume", "resume version", "cv", "cv version"],
  referral: ["referral", "referred by", "referrer", "contact"],
  note: ["notes", "note", "comments", "comment", "summary"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Best-effort automatic mapping from header names; the user can adjust every choice. */
export function suggestMapping(headers: string[]): ImportMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ImportMapping;
  const used = new Set<number>();
  const normalized = headers.map(normalizeHeader);

  for (const field of IMPORT_FIELDS) {
    const synonyms = HEADER_SYNONYMS[field];
    let matchIndex: number | null = null;
    for (const synonym of synonyms) {
      const index = normalized.findIndex((h, i) => !used.has(i) && h === synonym);
      if (index !== -1) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex !== null) {
      mapping[field] = matchIndex;
      used.add(matchIndex);
    }
  }
  return mapping;
}

export function missingRequiredMappings(mapping: ImportMapping): ImportField[] {
  return REQUIRED_IMPORT_FIELDS.filter((field) => mapping[field] === null);
}

export type RawImportRow = Partial<Record<ImportField, string>>;

/** Apply the mapping to one CSV data row. Unmapped fields are absent. */
export function applyMapping(row: string[], mapping: ImportMapping): RawImportRow {
  const out: RawImportRow = {};
  for (const field of IMPORT_FIELDS) {
    const index = mapping[field];
    if (index !== null && index !== undefined) {
      out[field] = row[index] ?? "";
    }
  }
  return out;
}
