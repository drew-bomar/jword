import { z } from "zod";
import {
  isoDateSchema,
  requestIdSchema,
  urlSchema,
  uuidSchema,
  versionSchema,
  workArrangementSchema,
} from "../validation/schemas";
import { CAPTURE_UPDATE_FIELDS } from "./plan";

/**
 * Boundary schemas for the extension capture API (decision 017). They narrow what the extension
 * may ask for; the shared services still validate every command with their own schemas.
 */

/** Find an application the duplicate check missed (e.g. "Acme" vs "Acme Inc."). */
export const captureSearchSchema = z.strictObject({ text: z.string().trim().min(1).max(200) });

/** Current values and version of the application the owner chose to update. */
export const captureTargetSchema = z.strictObject({ applicationId: uuidSchema });

const postingText = (max: number) => z.string().trim().min(1).max(max).optional();

/**
 * An update from a capture may only write posting fields (CAPTURE_UPDATE_FIELDS), and never
 * clears one: there is no null and no UNKNOWN work arrangement. Status, priority, owner dates,
 * company, and title are rejected by the strict object.
 */
export const capturePostingUpdateSchema = z
  .strictObject({
    requestId: requestIdSchema,
    applicationId: uuidSchema,
    expectedVersion: versionSchema,
    jobUrl: urlSchema.optional(),
    externalJobId: postingText(100),
    location: postingText(200),
    workArrangement: workArrangementSchema.exclude(["UNKNOWN"]).optional(),
    datePosted: isoDateSchema.optional(),
    source: postingText(100),
    description: postingText(10_000),
  })
  .refine((value) => CAPTURE_UPDATE_FIELDS.some((field) => value[field] !== undefined), {
    message: "Select at least one field to update.",
  });
export type CapturePostingUpdate = z.infer<typeof capturePostingUpdateSchema>;
