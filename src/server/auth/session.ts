import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { JwordError, type ActorContext } from "@jword/core";
import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface WebSession {
  actor: ActorContext;
  email: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}

/**
 * Verify the browser session with the auth server and build the actor context.
 * Every Server Action and protected page calls this; a page-level check is not enough.
 */
export async function requireSession(): Promise<WebSession> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new JwordError("UNAUTHENTICATED", "Sign in to continue.");
  }
  return {
    actor: { userId: user.id, actorType: "USER", correlationId: randomUUID() },
    email: user.email ?? null,
    supabase,
  };
}

/**
 * Discovery (watchlist, Leads, job checks, search preferences) is owner-only (decision 027).
 * This is the only place that decides it. Unset JWORD_OWNER_USER_ID means nobody (fail closed).
 */
export function canUseDiscovery(session: Pick<WebSession, "actor">): boolean {
  const { ownerUserId } = serverEnv();
  return ownerUserId !== null && session.actor.userId === ownerUserId;
}

/** Every discovery entry point calls this. Others get NOT_FOUND: the feature looks absent. */
export async function requireDiscoverySession(): Promise<WebSession> {
  const session = await requireSession();
  if (!canUseDiscovery(session)) {
    throw new JwordError("NOT_FOUND", "This page could not be found.", {
      reason: "FEATURE_UNAVAILABLE",
    });
  }
  return session;
}

/** Page variant: redirect to sign-in when signed out. */
export async function requirePageSession(): Promise<WebSession> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof JwordError && error.code === "UNAUTHENTICATED") {
      redirect("/sign-in");
    }
    throw error;
  }
}

/** Discovery page variant: sign-in redirect, then a plain 404 for users without discovery. */
export async function requireDiscoveryPageSession(): Promise<WebSession> {
  const session = await requirePageSession();
  if (!canUseDiscovery(session)) notFound();
  return session;
}
