import path from "node:path";
import type { RelayRequest, TunnelMessage } from "@harness/core";
import { findTool, truncate } from "@harness/tools";
import type { AuditEntry } from "./audit.js";

type ToolRequest = Extract<RelayRequest, { type: "tool" }>;

// "name=path" entries separated by the platform path delimiter; a bare path is named after its folder.
export const parseRoots = (value: string | undefined): Record<string, string> => {
  const roots: Record<string, string> = {};
  for (const entry of (value ?? "").split(path.delimiter)) {
    const text = entry.trim();
    if (!text) {
      continue;
    }
    // A Windows drive letter ("C:\x") contains a colon but no "=", so "=" is the only separator that matters.
    const eq = text.indexOf("=");
    const name = eq > 0 ? text.slice(0, eq).trim() : path.basename(text);
    const dir = eq > 0 ? text.slice(eq + 1).trim() : text;
    if (name && dir) {
      roots[name] = path.resolve(dir);
    }
  }
  return roots;
};

// Runs the tools the gateway asks for, only inside the project roots this device chose to expose and only the
// tools in `allowed`. Anything else is refused here, whatever the gateway sends.
export const createToolServer = (opts: { roots: Record<string, string>; allowed: string[]; audit?: (entry: AuditEntry) => void }) => {
  const allowed = new Set(opts.allowed);

  return {
    rootNames: (): string[] => {
      return Object.keys(opts.roots);
    },
    allowedNames: (): string[] => {
      return [...allowed];
    },
    async handle(msg: ToolRequest, send: (m: TunnelMessage) => void): Promise<void> {
      const started = Date.now();
      const finish = (ok: boolean, output: string, outcome: AuditEntry["outcome"], summary: string): void => {
        send({ type: "tool-result", id: msg.id, ok, output });
        opts.audit?.({
          time: new Date(started).toISOString(),
          session: msg.session,
          root: msg.root,
          tool: msg.name,
          summary,
          outcome,
          ...(ok ? {} : { detail: output.slice(0, 200) }),
          ms: Date.now() - started,
        });
      };

      const tool = findTool(msg.name);
      const summary = tool ? tool.describe(msg.args) : msg.name;
      const cwd = Object.hasOwn(opts.roots, msg.root) ? opts.roots[msg.root] : undefined;
      if (!cwd) {
        finish(false, `unknown project root "${msg.root}"`, "refused", summary);
        return;
      }
      if (!tool || !allowed.has(msg.name)) {
        finish(false, `tool "${msg.name}" is not allowed on this device`, "refused", summary);
        return;
      }
      try {
        finish(true, truncate(await tool.run(msg.args, { cwd })), "ok", summary);
      } catch (err) {
        finish(false, (err as Error).message, "error", summary);
      }
    },
  };
};

export type ToolServer = ReturnType<typeof createToolServer>;
