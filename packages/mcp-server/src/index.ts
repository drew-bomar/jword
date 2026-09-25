#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createClock,
  createCachedBoardDirectory,
  createPublicBoardDirectory,
  createTrackerServices,
  stderrLogger,
  SupabaseTrackerRepository,
  type ActorContext,
} from "@jword/core";
import { createServiceRoleClient, verifyOwner } from "./client";
import { loadEnv } from "./env";
import { createJwordServer } from "./server";

// stdout is reserved for the MCP protocol; every diagnostic goes to stderr.
const log = (message: string) => process.stderr.write(`[jword-mcp] ${message}\n`);

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createServiceRoleClient(env.supabaseUrl, env.serviceRoleKey);
  await verifyOwner(client, env.ownerUserId);

  const services = createTrackerServices({
    repository: new SupabaseTrackerRepository(client),
    clock: createClock(env.timeZone),
    logger: stderrLogger,
    boardDirectory: createCachedBoardDirectory(createPublicBoardDirectory()),
  });
  const actor: ActorContext = { userId: env.ownerUserId, actorType: "CODEX" };

  const server = createJwordServer({ services, actor });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready (timezone ${env.timeZone})`);
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : "failed to start");
  process.exit(1);
});
