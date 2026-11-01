import fs from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  time: string;
  session?: string;
  root: string;
  tool: string;
  // A human-readable description of the call. It names files and commands but never includes file contents.
  summary: string;
  outcome: "ok" | "error" | "refused";
  detail?: string;
  ms: number;
}

// Appends one JSON line per tool call to a file on this device, so what the gateway asked for is on record here
// even if the gateway cannot be trusted. Writes are queued in order; a failure to write is reported once.
export function createAuditLog(file: string, warn: (message: string) => void = console.warn): (entry: AuditEntry) => void {
  let queue: Promise<unknown> = fs.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  let warned = false;
  return (entry) => {
    queue = queue
      .then(() => fs.appendFile(file, JSON.stringify(entry) + String.fromCharCode(10), { mode: 0o600 }))
      .catch((err: Error) => {
        if (warned) return;
        warned = true;
        warn(`[agent] cannot write the audit log ${file}: ${err.message}`);
      });
  };
}
