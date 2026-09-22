import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
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
  const env = serverEnv();
  if (env.ownerUserId && user.id !== env.ownerUserId) {
    throw new JwordError("FORBIDDEN", "This account is not the configured owner of this tracker.");
  }
  return {
    actor: { userId: user.id, actorType: "USER", correlationId: randomUUID() },
    email: user.email ?? null,
    supabase,
  };
}

/** Page variant: redirect to sign-in when signed out; surface FORBIDDEN as a page. */
export async function requirePageSession(): Promise<WebSession> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof JwordError && error.code === "UNAUTHENTICATED") {
      redirect("/sign-in");
    }
    if (error instanceof JwordError && error.code === "FORBIDDEN") {
      redirect("/forbidden");
    }
    throw error;
  }
}
