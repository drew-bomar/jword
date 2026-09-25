import { parseOrThrow, verifyBoardsSchema } from "@jword/core";
import { extensionEndpoint } from "@/server/extension-api";
import { servicesFor } from "@/server/services";

export const POST = extensionEndpoint((session, input) =>
  servicesFor(session).discoverCompanyBoards(
    { ...parseOrThrow(verifyBoardsSchema, input), mode: "verify" },
    session.actor,
  ),
);
