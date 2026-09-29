import * as z from "zod";
import { requestIdSchema, versionSchema } from "../validation/schemas";
import { CITY_KEYS } from "./cities";
import { EMPLOYMENT_TARGETS, MAX_PREFERRED_CITIES, ROLE_FAMILIES, TARGET_LEVELS } from "./types";

const roleList = z
  .array(z.enum(ROLE_FAMILIES, { error: "Unknown role family." }))
  .max(ROLE_FAMILIES.length)
  .refine((roles) => new Set(roles).size === roles.length, "Each role can be listed once.");

/**
 * Save the whole preference set. expectedVersion is omitted only for the first save; later
 * saves must send the version they read (STALE_VERSION otherwise).
 */
export const saveSearchPreferencesSchema = z
  .strictObject({
    requestId: requestIdSchema,
    expectedVersion: versionSchema.optional(),
    targetLevel: z.enum(TARGET_LEVELS, { error: "Choose a target level." }),
    employmentTarget: z.enum(EMPLOYMENT_TARGETS, { error: "Choose an employment type." }),
    preferredStartMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month (YYYY-MM).")
      .nullable(),
    preferredCities: z
      .array(z.enum(CITY_KEYS as [string, ...string[]], { error: "Unknown city." }))
      .max(MAX_PREFERRED_CITIES, `Choose at most ${MAX_PREFERRED_CITIES} cities.`)
      .refine((cities) => new Set(cities).size === cities.length, "Each city can be listed once."),
    hideRemoteOnly: z.boolean(),
    preferredRoles: roleList,
    deemphasizedRoles: roleList,
    maxPostingAgeDays: z.number().int().min(1).max(365).nullable(),
  })
  .refine((value) => !value.preferredRoles.some((role) => value.deemphasizedRoles.includes(role)), {
    message: "A role cannot be both preferred and de-emphasized.",
    path: ["deemphasizedRoles"],
  });
export type SaveSearchPreferencesCommand = z.infer<typeof saveSearchPreferencesSchema>;
