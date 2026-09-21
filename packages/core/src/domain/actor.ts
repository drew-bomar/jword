import type { ActorType } from "./enums";

/**
 * Who is performing an operation. Assigned by the authenticated entry point
 * (Server Action or MCP handler), never by form or tool arguments.
 */
export interface ActorContext {
  userId: string;
  actorType: ActorType;
  /** Optional correlation id for logs. Not the mutation requestId. */
  correlationId?: string;
}
