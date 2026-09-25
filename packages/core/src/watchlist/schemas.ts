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
import { BOARD_IDENTIFIER_PATTERN, canonicalBoardUrl } from "./boards";

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

export const MAX_BOARDS_PER_WATCH = 3;

/**
 * One board: a supported provider with its identifier (the URL is derived), or OTHER with a
 * careers page URL. Mirrored by jword.normalize_boards() and the company_watch_boards checks.
 */
export const boardInputSchema = z
  .strictObject({
    provider: atsProviderSchema,
    boardIdentifier: optionalBoardIdentifier,
    /** Careers page for OTHER only; supported providers derive their board URL. */
    boardUrl: optionalUrl,
  })
  .superRefine((board, ctx) => {
    if (board.provider === "OTHER") {
      if (board.boardIdentifier) {
        ctx.addIssue({
          code: "custom",
          path: ["boardIdentifier"],
          message:
            "Other has no board identifier. Choose Greenhouse, Lever, or Ashby, or clear it.",
        });
      }
      if (!board.boardUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["boardUrl"],
          message: "Enter the careers page URL.",
        });
      }
      return;
    }
    if (!board.boardIdentifier) {
      ctx.addIssue({
        code: "custom",
        path: ["boardIdentifier"],
        message: `Enter the ${ATS_PROVIDER_LABELS[board.provider]} board identifier.`,
      });
    }
    if (board.boardUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["boardUrl"],
        message: "The board URL is set from the provider and identifier.",
      });
    }
  });
export type BoardInput = z.infer<typeof boardInputSchema>;

/** Stable identity of a board: provider + identifier (any case), or a careers URL. */
export function boardKey(board: {
  provider: AtsProvider;
  boardIdentifier?: string | null;
  boardUrl?: string | null;
}): string {
  return board.boardIdentifier
    ? `${board.provider}:${board.boardIdentifier.toLowerCase()}`
    : `URL:${(board.boardUrl ?? "").toLowerCase()}`;
}

export const boardsSchema = z
  .array(boardInputSchema)
  .max(MAX_BOARDS_PER_WATCH, `A company can have at most ${MAX_BOARDS_PER_WATCH} boards.`)
  .superRefine((boards, ctx) => {
    const seen = new Set<string>();
    const urls = new Set<string>();
    boards.forEach((board, index) => {
      const key = boardKey(board);
      const url = (
        board.provider === "OTHER"
          ? (board.boardUrl ?? "")
          : canonicalBoardUrl(board.provider, board.boardIdentifier ?? "")
      ).toLowerCase();
      if (seen.has(key) || urls.has(url)) {
        ctx.addIssue({ code: "custom", path: [index], message: "The same board is listed twice." });
      }
      seen.add(key);
      urls.add(url);
    });
  });

/** The reused company fields. */
const companyFields = {
  interestLevel: interestLevelSchema.nullable().optional(),
  websiteUrl: optionalUrl,
  companyNotes: optionalText(5000),
};

export const addWatchedCompanySchema = z
  .strictObject({
    requestId: requestIdSchema,
    /** Company name: reuses an exact decision-013 match or creates the company. */
    company: requiredText(200, "Company").optional(),
    /** Explicitly selected existing company; wins over the name and must belong to the owner. */
    companyId: uuidSchema.optional(),
    /** Zero to three boards. A watch without boards is still watched, with nothing to read yet. */
    boards: boardsSchema.optional(),
    ...companyFields,
  })
  .superRefine((value, ctx) => {
    if (!value.company && !value.companyId) {
      ctx.addIssue({ code: "custom", path: ["company"], message: "Company is required." });
    }
  });
export type AddWatchedCompanyCommand = z.infer<typeof addWatchedCompanySchema>;

export const EDITABLE_WATCH_FIELDS = [
  "boards",
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
    /** Replaces the whole board set (0-3), in order. */
    boards: boardsSchema.optional(),
    ...companyFields,
  })
  .superRefine((value, ctx) => {
    if (!EDITABLE_WATCH_FIELDS.some((field) => value[field] !== undefined)) {
      ctx.addIssue({ code: "custom", message: "Supply at least one field to update." });
    }
  });
export type UpdateWatchedCompanyCommand = z.infer<typeof updateWatchedCompanySchema>;

export const setCompanyWatchStatusSchema = z.strictObject({
  requestId: requestIdSchema,
  watchId: uuidSchema,
  expectedVersion: versionSchema,
  active: z.boolean({ error: "active must be true or false." }),
});
export type SetCompanyWatchStatusCommand = z.infer<typeof setCompanyWatchStatusSchema>;

export const deleteWatchedCompanySchema = z.strictObject({
  requestId: requestIdSchema,
  watchId: uuidSchema,
  expectedVersion: versionSchema,
  confirmed: z.literal(true, { error: "Confirm deleting this watch." }),
});
export type DeleteWatchedCompanyCommand = z.infer<typeof deleteWatchedCompanySchema>;

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

export const discoverBoardsSchema = z
  .strictObject({
    /** Company name to look up; used when no companyId is given. */
    company: requiredText(200, "Company").optional(),
    /** Existing company: its saved applications and website add evidence. */
    companyId: uuidSchema.optional(),
    /** Company website, for one more board-name guess and a domain check. */
    websiteUrl: optionalUrl,
  })
  .superRefine((value, ctx) => {
    if (!value.company && !value.companyId) {
      ctx.addIssue({ code: "custom", path: ["company"], message: "Company is required." });
    }
  });
export type DiscoverBoardsInput = z.infer<typeof discoverBoardsSchema>;
