export interface LogEvent {
  operation: string;
  actorType?: string;
  correlationId?: string;
  requestId?: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  applicationId?: string;
  noteId?: string;
  noop?: boolean;
  replayed?: boolean;
}

export interface Logger {
  log(event: LogEvent): void;
}

/** JSON line per operation to stderr. Never logs notes, CSV rows, or secrets. */
export const stderrLogger: Logger = {
  log(event) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  },
};

export const silentLogger: Logger = { log: () => undefined };
