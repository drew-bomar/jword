import { inferBoardFromUrl } from "./boards";
import { boardKey } from "./schemas";
import type { WatchBoard } from "./types";

/** Recognize old careers links without silently changing their saved provider. */
export function recognizedBoardKey(board: WatchBoard): string {
  return boardKey(
    board.provider === "OTHER" ? (inferBoardFromUrl(board.boardUrl) ?? board) : board,
  );
}

/** Explicit selection upgrades an equivalent legacy URL in place, keeping unrelated boards. */
export function selectWatchBoard(selected: WatchBoard[], board: WatchBoard): WatchBoard[] {
  const key = recognizedBoardKey(board);
  const index = selected.findIndex((item) => recognizedBoardKey(item) === key);
  if (index === -1) return [...selected, board];
  return selected.flatMap((item, i) =>
    i === index ? [board] : recognizedBoardKey(item) === key ? [] : [item],
  );
}
