import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JwordError } from "@jword/core/browser";
import { canUseDiscovery, requireDiscoverySession, requireSession } from "./session";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const signedInAs = (id: string) =>
  getUser.mockResolvedValue({ data: { user: { id, email: `${id}@example.com` } } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("JWORD_OWNER_USER_ID", OWNER);
});
afterEach(() => {
  vi.unstubAllEnvs();
  getUser.mockReset();
});

it("lets any signed-in user in; the owner id no longer locks the app (decision 027)", async () => {
  signedInAs(OTHER);
  await expect(requireSession()).resolves.toMatchObject({ actor: { userId: OTHER } });
});

it("refuses signed-out requests", async () => {
  getUser.mockResolvedValue({ data: { user: null } });
  await expect(requireSession()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

it("gives discovery only to the owner and answers NOT_FOUND to everyone else", async () => {
  signedInAs(OWNER);
  const owner = await requireDiscoverySession();
  expect(canUseDiscovery(owner)).toBe(true);

  signedInAs(OTHER);
  const refusal = await requireDiscoverySession().catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(JwordError);
  expect(refusal).toMatchObject({ code: "NOT_FOUND", reason: "FEATURE_UNAVAILABLE" });
});

it.each(["", "   "])("fails closed when JWORD_OWNER_USER_ID is unset (%j)", async (value) => {
  vi.stubEnv("JWORD_OWNER_USER_ID", value);
  signedInAs(OWNER);
  expect(canUseDiscovery(await requireSession())).toBe(false);
  await expect(requireDiscoverySession()).rejects.toMatchObject({ code: "NOT_FOUND" });
});
