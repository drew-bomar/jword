import { z } from "zod";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
  WORK_ARRANGEMENTS,
} from "../domain/enums";
import { isIsoDate } from "../domain/dates";
import { JwordError } from "../domain/errors";

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;
/** The web table shows more rows than an agent needs; still bounded. */
export const WEB_LIST_MAX_LIMIT = 200;
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1_000_000;

const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** Trimmed text with an upper bound; blank strings become null. */
export const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().min(1).max(max).nullable().optional());

export const requiredText = (max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date (YYYY-MM-DD).")
  .refine(isIsoDate, "Not a valid calendar date.");

export const optionalDate = z.preprocess(blankToNull, isoDateSchema.nullable().optional());

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https?:\/\/\S+$/i.test(value), "Must start with http:// or https://");

export const optionalUrl = z.preprocess(blankToNull, urlSchema.nullable().optional());

export const uuidSchema = z.uuid({ error: "Must be a UUID." });
export const statusSchema = z.enum(APPLICATION_STATUSES, { error: "Unknown status." });
export const prioritySchema = z.enum(APPLICATION_PRIORITIES, { error: "Unknown priority." });
export const workArrangementSchema = z.enum(WORK_ARRANGEMENTS, {
  error: "Unknown work arrangement.",
});
export const versionSchema = z.number().int().positive({ error: "expectedVersion must be a positive integer." });
export const requestIdSchema = uuidSchema;

// ---------------------------------------------------------------------------
// Mutation commands
// ---------------------------------------------------------------------------

export const createApplicationSchema = z.strictObject({
  requestId: requestIdSchema,
  company: requiredText(200, "Company"),
  /** Explicitly selected existing company (must belong to the owner). */
  companyId: uuidSchema.optional(),
  title: requiredText(200, "Job title"),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  jobUrl: optionalUrl,
  externalJobId: optionalText(100),
  location: optionalText(200),
  workArrangement: workArrangementSchema.optional(),
  description: optionalText(10_000),
  datePosted: optionalDate,
  /** Omitted: defaults to today (interactive). Null: deliberately blank. */
  dateFound: optionalDate,
  /** Omitted: defaults to today when status is APPLIED. Null: deliberately blank. */
  appliedAt: optionalDate,
  source: optionalText(100),
  resumeVersion: optionalText(100),
  referral: optionalText(200),
  initialNote: optionalText(5000),
  /** Set after the caller reviewed duplicate candidates and chose to create anyway. */
  allowDuplicate: z.boolean().optional(),
});
export type CreateApplicationCommand = z.infer<typeof createApplicationSchema>;

export const updateApplicationStatusSchema = z.strictObject({
  requestId: requestIdSchema,
  applicationId: uuidSchema,
  expectedVersion: versionSchema,
  status: statusSchema,
  appliedAt: optionalDate,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type UpdateApplicationStatusCommand = z.infer<typeof updateApplicationStatusSchema>;

export const EDITABLE_DETAIL_FIELDS = [
  "priority",
  "appliedAt",
  "dateFound",
  "source",
  "resumeVersion",
  "referral",
  "jobUrl",
  "externalJobId",
  "location",
  "workArrangement",
  "title",
  "company",
  "companyId",
  "datePosted",
  "description",
] as const;
export type EditableDetailField = (typeof EDITABLE_DETAIL_FIELDS)[number];

export const updateApplicationDetailsSchema = z
  .strictObject({
    requestId: requestIdSchema,
    applicationId: uuidSchema,
    expectedVersion: versionSchema,
    priority: prioritySchema.optional(),
    appliedAt: optionalDate,
    dateFound: optionalDate,
    source: optionalText(100),
    resumeVersion: optionalText(100),
    referral: optionalText(200),
    jobUrl: optionalUrl,
    externalJobId: optionalText(100),
    location: optionalText(200),
    workArrangement: workArrangementSchema.optional(),
    title: requiredText(200, "Job title").optional(),
    company: requiredText(200, "Company").optional(),
    companyId: uuidSchema.optional(),
    datePosted: optionalDate,
    description: optionalText(10_000),
  })
  .refine((value) => EDITABLE_DETAIL_FIELDS.some((field) => value[field] !== undefined), {
    message: "Supply at least one field to update.",
  });
export type UpdateApplicationDetailsCommand = z.infer<typeof updateApplicationDetailsSchema>;

export const addApplicationNoteSchema = z.strictObject({
  requestId: requestIdSchema,
  applicationId: uuidSchema,
  expectedVersion: versionSchema,
  note: requiredText(5000, "Note"),
  noteDate: optionalDate,
});
export type AddApplicationNoteCommand = z.infer<typeof addApplicationNoteSchema>;

export const updateApplicationNoteSchema = z
  .strictObject({
    requestId: requestIdSchema,
    applicationId: uuidSchema,
    noteId: uuidSchema,
    expectedVersion: versionSchema,
    note: requiredText(5000, "Note").optional(),
    /** Omitted keeps the current date; null removes the label. */
    noteDate: optionalDate,
  })
  .refine((value) => value.note !== undefined || value.noteDate !== undefined, {
    message: "Supply new note text and/or a note date.",
  });
export type UpdateApplicationNoteCommand = z.infer<typeof updateApplicationNoteSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const searchApplicationsSchema = z.strictObject({
  text: z.string().trim().max(200).optional(),
  statuses: z.array(statusSchema).max(APPLICATION_STATUSES.length).optional(),
  priorities: z.array(prioritySchema).max(APPLICATION_PRIORITIES.length).optional(),
  appliedFrom: isoDateSchema.optional(),
  appliedTo: isoDateSchema.optional(),
  updatedBefore: z.union([isoDateSchema, z.iso.datetime({ offset: true })]).optional(),
  sort: z.enum(["updated", "applied", "company", "priority"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(WEB_LIST_MAX_LIMIT).optional(),
  cursor: z.string().max(200).optional(),
});
export type SearchApplicationsInput = z.infer<typeof searchApplicationsSchema>;

export const getApplicationSchema = z.strictObject({
  applicationId: uuidSchema,
  notesLimit: z.number().int().min(1).max(50).optional(),
  notesCursor: z.string().max(200).optional(),
  activityLimit: z.number().int().min(1).max(50).optional(),
});
export type GetApplicationInput = z.infer<typeof getApplicationSchema>;

export const listActivitySchema = z.strictObject({
  applicationId: uuidSchema,
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().max(200).optional(),
});
export type ListActivityInput = z.infer<typeof listActivitySchema>;

export const pipelineSummarySchema = z.strictObject({
  staleAfterDays: z.number().int().min(1).max(365).optional(),
  staleLimit: z.number().int().min(1).max(25).optional(),
});
export type PipelineSummaryInput = z.infer<typeof pipelineSummarySchema>;

// ---------------------------------------------------------------------------
// Candidate profile
// ---------------------------------------------------------------------------

export const candidateProfileSchema = z.strictObject({
  fullName: optionalText(200),
  email: z.preprocess(blankToNull, z.email("Enter a valid email.").max(320).nullable().optional()),
  phone: optionalText(50),
  location: optionalText(200),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  school: optionalText(200),
  degree: optionalText(200),
  graduationDate: optionalDate,
  workAuthorization: optionalText(200),
  requiresSponsorship: z.boolean().nullable().optional(),
});
export type CandidateProfileCommand = z.infer<typeof candidateProfileSchema>;

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const importRowSchema = z.strictObject({
  rowIndex: z.number().int().positive(),
  company: requiredText(200, "Company"),
  title: requiredText(200, "Job title"),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  jobUrl: optionalUrl,
  externalJobId: optionalText(100),
  location: optionalText(200),
  workArrangement: workArrangementSchema.optional(),
  datePosted: optionalDate,
  dateFound: optionalDate,
  appliedAt: optionalDate,
  source: optionalText(100),
  resumeVersion: optionalText(100),
  referral: optionalText(200),
  note: optionalText(10_000),
  duplicateChoice: z.enum(["import_separate"]).optional(),
});
export type ImportRowCommand = z.infer<typeof importRowSchema>;

export const commitImportSchema = z.strictObject({
  requestId: requestIdSchema,
  rows: z.array(importRowSchema).min(1, "Select at least one row.").max(IMPORT_MAX_ROWS),
});
export type CommitImportCommand = z.infer<typeof commitImportSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Validate at a boundary; throws a typed VALIDATION_ERROR with per-field messages. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors = fieldErrorsFromZod(result.error);
  const first = result.error.issues[0];
  const where = first && first.path.length ? `${first.path.map(String).join(".")}: ` : "";
  return (() => {
    throw new JwordError("VALIDATION_ERROR", `${where}${first?.message ?? "Invalid input."}`, {
      fieldErrors,
    });
  })();
}

/** Remove keys whose value is undefined so "absent" and "null" stay distinct on the wire. */
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}
