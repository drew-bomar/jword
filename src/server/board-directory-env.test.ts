import { describe, expect, it } from "vitest";
import { assertBoardDirectoryEnvironment } from "./board-directory-env";

describe("board fixture environment", () => {
  it("permits live mode and explicitly local browser tests, including production builds", () => {
    expect(() => assertBoardDirectoryEnvironment({})).not.toThrow();
    expect(() =>
      assertBoardDirectoryEnvironment({
        NODE_ENV: "production",
        JWORD_BOARD_DIRECTORY: "fixtures",
        JWORD_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });
  it("refuses accidental fixture configuration and conflicting hosted URLs", () => {
    for (const env of [
      { JWORD_BOARD_DIRECTORY: "fixtures" },
      { JWORD_BOARD_DIRECTORY: "typo" },
      {
        JWORD_BOARD_DIRECTORY: "fixtures",
        JWORD_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://hosted.supabase.co",
      },
      {
        JWORD_BOARD_DIRECTORY: "fixtures",
        JWORD_E2E: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SUPABASE_URL: "https://hosted.supabase.co",
      },
    ])
      expect(() => assertBoardDirectoryEnvironment(env)).toThrow();
  });
});
