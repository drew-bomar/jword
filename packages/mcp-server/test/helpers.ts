import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createFixtureBoardDirectory,
  createTrackerServices,
  E2E_FIXTURE_BOARDS,
  FakeTrackerRepository,
  fixedClock,
  type ActorContext,
  type MutationResult,
} from "@jword/core";
import { createJwordServer } from "../src/server";

export const OWNER_ID = "11111111-1111-1111-1111-111111111111";
export const OTHER_ID = "22222222-2222-2222-2222-222222222222";
export const TODAY = "2026-09-21";

export interface Harness {
  client: Client;
  repo: FakeTrackerRepository;
  services: ReturnType<typeof createTrackerServices>;
  actor: ActorContext;
  call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ raw: CallToolResult; body: Record<string, unknown> }>;
  /** Seed an application directly through the shared service (actor USER), bypassing MCP. */
  seed: (userId: string, input: Record<string, unknown>) => Promise<MutationResult>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const repo = new FakeTrackerRepository();
  const services = createTrackerServices({
    repository: repo,
    clock: fixedClock(TODAY),
    boardDirectory: createFixtureBoardDirectory(E2E_FIXTURE_BOARDS),
  });
  const actor: ActorContext = { userId: OWNER_ID, actorType: "CODEX" };
  const server = createJwordServer({ services, actor });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  const call: Harness["call"] = async (name, args) => {
    const raw = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = raw.content.find((c) => c.type === "text");
    const body =
      text && text.type === "text" ? (JSON.parse(text.text) as Record<string, unknown>) : {};
    return { raw, body };
  };

  const seed: Harness["seed"] = (userId, input) =>
    services.createApplication(
      { requestId: crypto.randomUUID(), ...input },
      { userId, actorType: "USER" },
    );

  return {
    client,
    repo,
    services,
    actor,
    call,
    seed,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
