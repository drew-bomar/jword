"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { IMPORT_FIELDS, IMPORT_MAX_BYTES, type MutationResult } from "@jword/core/browser";
import { safeMutationResult, type ImportPreview } from "@jword/core";
import { requireSession } from "@/server/auth/session";
import { servicesFor } from "@/server/services";
import { runAction, type ActionResult } from "./result";

const mappingSchema = z.object(
  Object.fromEntries(
    IMPORT_FIELDS.map((field) => [field, z.number().int().min(0).nullable()]),
  ) as Record<(typeof IMPORT_FIELDS)[number], z.ZodNullable<z.ZodNumber>>,
);

const previewSchema = z.strictObject({
  csvText: z.string().max(IMPORT_MAX_BYTES, "CSV is too large."),
  mapping: mappingSchema,
});

/** Phase 1: nothing is written. The CSV text is used transiently and never stored. */
export async function previewImportAction(input: unknown): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const session = await requireSession();
    const parsed = previewSchema.parse(input);
    return servicesFor(session).previewImport(parsed, session.actor);
  });
}

/** Phase 2: commit the confirmed rows in one transaction. */
export async function commitImportAction(input: unknown): Promise<ActionResult<MutationResult>> {
  return runAction(async () => {
    const session = await requireSession();
    const result = await servicesFor(session).commitImport(input, session.actor);
    revalidatePath("/");
    return safeMutationResult(result);
  });
}
