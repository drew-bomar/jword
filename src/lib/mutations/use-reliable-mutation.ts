"use client";

import { useRef, useState } from "react";
import type { ActionResult } from "@/server/actions/result";
import { createMutationAttempt } from "./attempt";

export function useReliableMutation() {
  const attempt = useRef(createMutationAttempt());
  const [unconfirmed, setUnconfirmed] = useState(false);
  async function save<T>(
    command: Record<string, unknown>,
    perform: (input: unknown) => Promise<ActionResult<T>>,
  ) {
    const result = await attempt.current.run(command, perform);
    setUnconfirmed(attempt.current.unresolved);
    return result;
  }
  return { save, unconfirmed };
}
