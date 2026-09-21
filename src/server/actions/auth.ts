"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./result";

const emailSchema = z.strictObject({ email: z.email("Enter a valid email address.") });
const codeSchema = z.strictObject({
  email: z.email("Enter a valid email address."),
  token: z.string().trim().regex(/^\d{6,10}$/, "Enter the code from your email."),
});

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/** Sends a one-time code and magic link. Only existing accounts can sign in (no self-signup). */
export async function requestSignInCode(input: { email: string }): Promise<ActionResult<{ email: string }>> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid email." } };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) {
    // Do not reveal whether the account exists beyond what Supabase already returns.
    const message = /signups? not allowed|not found/i.test(error.message)
      ? "That email is not registered as the owner of this tracker."
      : "Could not send a sign-in email. Try again in a moment.";
    return { ok: false, error: { code: "UNAUTHENTICATED", message } };
  }
  return { ok: true, data: { email: parsed.data.email } };
}

export async function verifySignInCode(input: { email: string; token: string }): Promise<ActionResult<null>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid code." } };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.token, type: "email" });
  if (error) {
    return { ok: false, error: { code: "UNAUTHENTICATED", message: "That code is invalid or has expired." } };
  }
  return { ok: true, data: null };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
