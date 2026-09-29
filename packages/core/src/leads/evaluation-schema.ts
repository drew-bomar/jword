import * as z from "zod";
import { CITY_KEYS } from "../preferences/cities";
import { ROLE_FAMILIES } from "../preferences/types";
import {
  EXCLUSION_CODES,
  FLAG_CODES,
  LEAD_ARRANGEMENTS,
  LEAD_MATCHES,
  ROLE_FITS,
} from "./evaluate";

const field = z.enum([
  "title",
  "employmentType",
  "description",
  "location",
  "workplaceType",
  "profile",
]);
const finding = z.strictObject({ field, evidence: z.string().trim().min(1).max(160) });
const unique = <T>(values: T[]) => new Set(values).size === values.length;

/** Validate persisted JSON before it reaches rendering; SQL enforces the same write contract. */
export const leadEvaluationSchema = z
  .strictObject({
    match: z.enum(LEAD_MATCHES),
    exclusions: z
      .array(finding.extend({ code: z.enum(EXCLUSION_CODES) }))
      .max(EXCLUSION_CODES.length)
      .refine((items) => unique(items.map((item) => item.code))),
    flags: z
      .array(finding.extend({ code: z.enum(FLAG_CODES) }))
      .max(FLAG_CODES.length)
      .refine((items) => unique(items.map((item) => item.code))),
    arrangement: z.enum(LEAD_ARRANGEMENTS),
    arrangementField: field.nullable(),
    cities: z.array(z.enum(CITY_KEYS)).max(10).refine(unique),
    cityRank: z.number().int().min(1).max(10).nullable(),
    roleFamilies: z.array(z.enum(ROLE_FAMILIES)).max(ROLE_FAMILIES.length).refine(unique),
    roleFit: z.enum(ROLE_FITS),
    startMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .nullable(),
    startFit: z.enum(["PREFERRED", "EARLIER"]).nullable(),
  })
  .refine(
    (value) =>
      value.match ===
        (value.exclusions.length ? "EXCLUDED" : value.flags.length ? "UNCERTAIN" : "ELIGIBLE") &&
      (value.cityRank === null) === (value.cities.length === 0) &&
      (value.arrangement === "UNKNOWN") === (value.arrangementField === null) &&
      (value.startFit === null || value.startMonth !== null),
    "Inconsistent evaluation labels.",
  );

export function parseLeadEvaluation(value: unknown) {
  const result = leadEvaluationSchema.safeParse(value);
  return result.success ? result.data : null;
}
