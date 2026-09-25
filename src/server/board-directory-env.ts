/** Production builds are valid test targets, so use an explicit test flag plus local URLs. */
export function assertBoardDirectoryEnvironment(env: Record<string, string | undefined>): void {
  if (!env.JWORD_BOARD_DIRECTORY) return;
  if (env.JWORD_BOARD_DIRECTORY !== "fixtures")
    throw new Error("Unknown JWORD_BOARD_DIRECTORY mode.");
  const urls = [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL].filter(Boolean) as string[];
  const local = (value: string) => {
    try {
      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
    } catch {
      return false;
    }
  };
  if (env.JWORD_E2E !== "1" || !urls.length || !urls.every(local)) {
    throw new Error("Board fixtures require JWORD_E2E=1 and local Supabase URLs.");
  }
}
