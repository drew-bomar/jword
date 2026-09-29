import * as z from "zod";
import { requestIdSchema, uuidSchema, versionSchema } from "../validation/schemas";
import {
  LEAD_AVAILABILITIES,
  LEAD_REVIEW_STATUSES,
  LEAD_ROLE_FILTERS,
  LEAD_SORTS,
  LEAD_VIEWS,
} from "./types";

export const LEADS_DEFAULT_LIMIT = 50;
export const LEADS_MAX_LIMIT = 200;

/** One watch by id, or every active watch when omitted. */
export const checkForNewJobsSchema = z.strictObject({
  watchId: uuidSchema.optional(),
});
export type CheckForNewJobsInput = z.infer<typeof checkForNewJobsSchema>;

export const listLeadsSchema = z.strictObject({
  text: z.string().trim().max(200).optional(),
  companyId: uuidSchema.optional(),
  reviewStatus: z.enum(LEAD_REVIEW_STATUSES, { error: "Unknown review status." }).optional(),
  availability: z.enum(LEAD_AVAILABILITIES, { error: "Unknown availability." }).optional(),
  /** Defaults to RECOMMENDED (decision 026). */
  view: z.enum(LEAD_VIEWS, { error: "Unknown view." }).optional(),
  sort: z.enum(LEAD_SORTS, { error: "Unknown sort." }).optional(),
  role: z.enum(LEAD_ROLE_FILTERS, { error: "Unknown role filter." }).optional(),
  limit: z.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
  cursor: z.string().max(200).optional(),
});
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

export const getLeadSchema = z.strictObject({ leadId: uuidSchema });

/** Dismiss a lead, or restore a dismissed one to New. Promoted leads cannot change. */
export const setLeadReviewStatusSchema = z.strictObject({
  requestId: requestIdSchema,
  leadId: uuidSchema,
  expectedVersion: versionSchema,
  reviewStatus: z.enum(["NEW", "DISMISSED"], { error: "Choose New or Dismissed." }),
});
export type SetLeadReviewStatusCommand = z.infer<typeof setLeadReviewStatusSchema>;

/**
 * Create a SAVED application from the lead's stored posting and link them. Duplicate checks run
 * as for any new application; allowDuplicate is set only after the owner reviewed candidates.
 */
export const createApplicationFromLeadSchema = z.strictObject({
  requestId: requestIdSchema,
  leadId: uuidSchema,
  expectedVersion: versionSchema,
  allowDuplicate: z.boolean().optional(),
});
export type CreateApplicationFromLeadCommand = z.infer<typeof createApplicationFromLeadSchema>;
