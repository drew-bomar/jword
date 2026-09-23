import * as z from "zod";
import { ATS_PROVIDER_LABELS, ATS_PROVIDERS, type AtsProvider } from "../domain/enums";
import {
  optionalText,
  optionalUrl,
  requestIdSchema,
  requiredText,
  uuidSchema,
  versionSchema,
} from "../validation/schemas";
import { BOARD_IDENTIFIER_PATTERN } from "./boards";

export const WATCHLIST_DEFAULT_LIMIT = 10;
export const WATCHLIST_MCP_MAX_LIMIT = 25;
/** Web page size for the watchlist table. */
export const WATCHLIST_WEB_PAGE_SIZE = 50;
export const WATCHLIST_MAX_LIMIT = 200;
export const COMPANY_OPTIONS_MAX_LIMIT = 20;

const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const atsProviderSchema = z.enum(ATS_PROVIDERS, { error: "Unknown provider." });

export const boardIdentifierSchema = z
  .string()
  .trim()
  .max(100, "Board identifier must be at most 100 characters.")
  .regex(
    BOARD_IDENTIFIER_PATTERN,
    "Use the board name from the URL: letters, numbers, dots, dashes, or underscores.",
  );
const optionalBoardIdentifier = z.preprocess(
  blankToNull,
  boardIdentifierSchema.nullable().optional(),
);

export const interestLevelSchema = z
  .number()
  .int()
  .min(1, "Interest is 1 to 5.")
  .max(5, "Interest is 1 to 5.");

/** Fields shared by add and update: board configuration and the reused company fields. */
const watchFields = {
  boardIdentifier: optionalBoardIdentifier,
  /** Careers page for OTHER only; supported providers derive their board URL. */
  boardUrl: optionalUrl,
  interestLevel: interestLevelSchema.nullable().optional(),
  websiteUrl: optionalUrl,
  companyNotes: optionalText(5000),
};

interface BoardShape {
  provider?: AtsProvider;
  boardIdentifier?: string | null;
  boardUrl?: string | null;
}

/**
 * Board rules checkable from the command alone. `complete` means the command carries the whole
 * board configuration (creation). The database checks the final state again, including values
 * an update did not touch.
 */
function checkBoardShape(value: BoardShape, ctx: z.RefinementCtx, complete: boolean) {
  const { provider, boardIdentifier, boardUrl } = value;
  if (!provider) return;
  if (provider === "OTHER") {
    if (boardIdentifier) {
      ctx.addIssue({
        code: "custom",
        path: ["boardIdentifier"],
        message: "Other has no board identifier. Choose Greenhouse, Lever, or Ashby, or clear it.",
      });
    }
    return;
  }
  if (complete ? !boardIdentifier : boardIdentifier === null) {
    ctx.addIssue({
      code: "custom",
      path: ["boardIdentifier"],
      message: `Enter the ${ATS_PROVIDER_LABELS[provider]} board identifier.`,
    });
  }
  if (boardUrl) {
    ctx.addIssue({
      code: "custom",
      path: ["boardUrl"],
      message: "The board URL is set from the provider and identifier.",
    });
  }
}

export const addWatchedCompanySchema = z
  .strictObject({
    requestId: requestIdSchema,
    /** Company name: reuses an exact decision-013 match or creates the company. */
    company: requiredText(200, "Company").optional(),
    /** Explicitly selected existing company; wins over the name and must belong to the owner. */
    companyId: uuidSchema.optional(),
    provider: atsProviderSchema,
    ...watchFields,
  })
  .superRefine((value, ctx) => {
    if (!value.company && !value.companyId) {
      ctx.addIssue({ code: "custom", path: ["company"], message: "Company is required." });
    }
    checkBoardShape(value, ctx, true);
  });
export type AddWatchedCompanyCommand = z.infer<typeof addWatchedCompanySchema>;

export const EDITABLE_WATCH_FIELDS = [
  "provider",
  "boardIdentifier",
  "boardUrl",
  "interestLevel",
  "websiteUrl",
  "companyNotes",
] as const;
export type EditableWatchField = (typeof EDITABLE_WATCH_FIELDS)[number];

export const updateWatchedCompanySchema = z
  .strictObject({
    requestId: requestIdSchema,
    watchId: uuidSchema,
    expectedVersion: versionSchema,
    provider: atsProviderSchema.optional(),
    ...watchFields,
  })
  .superRefine((value, ctx) => {
    if (!EDITABLE_WATCH_FIELDS.some((field) => value[field] !== undefined)) {
      ctx.addIssue({ code: "custom", message: "Supply at least one field to update." });
    }
    checkBoardShape(value, ctx, false);
  });
export type UpdateWatchedCompanyCommand = z.infer<typeof updateWatchedCompanySchema>;

export const setCompanyWatchStatusSchema = z.strictObject({
  requestId: requestIdSchema,
  watchId: uuidSchema,
  expectedVersion: versionSchema,
  active: z.boolean({ error: "active must be true or false." }),
});
export type SetCompanyWatchStatusCommand = z.infer<typeof setCompanyWatchStatusSchema>;

export const listWatchedCompaniesSchema = z.strictObject({
  text: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
  provider: atsProviderSchema.optional(),
  limit: z.number().int().min(1).max(WATCHLIST_MAX_LIMIT).optional(),
  cursor: z.string().max(200).optional(),
});
export type ListWatchedCompaniesInput = z.infer<typeof listWatchedCompaniesSchema>;

export const getWatchedCompanySchema = z.strictObject({
  watchId: uuidSchema,
  activityLimit: z.number().int().min(1).max(50).optional(),
});
export type GetWatchedCompanyInput = z.infer<typeof getWatchedCompanySchema>;

export const searchCompaniesSchema = z.strictObject({
  text: z.string().trim().min(1, "Type part of a company name.").max(200),
  limit: z.number().int().min(1).max(COMPANY_OPTIONS_MAX_LIMIT).optional(),
});
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema>;
