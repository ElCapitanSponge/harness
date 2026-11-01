import path from "node:path";
import type { FileChange, RelayRequest, TunnelMessage } from "@harness/core";
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
export const createToolServer = (opts: { roots: Record<string, string>; allowed: string[]; readOnly?: string[]; audit?: (entry: AuditEntry) => void; installed?: (program: string) => boolean }) => {
  // A tool whose program is not on this device is neither offered nor run.
  const usable = (name: string): boolean => {
    const program = findTool(name)?.requires;
    return program === undefined || (opts.installed?.(program) ?? true);
  };
  let roots = opts.roots;
  let allowed = new Set(opts.allowed);
  // Roots that can only be read: a tool that could change anything there is refused, whatever the gateway sends.
  let readOnly = new Set(opts.readOnly ?? []);

  return {
    // Replaces what this device exposes, for a settings change that applies without a restart.
    configure(next: { roots: Record<string, string>; allowed: string[]; readOnly?: string[] }): void {
      roots = next.roots;
      allowed = new Set(next.allowed);
      readOnly = new Set(next.readOnly ?? []);
    },
    readOnlyNames: (): string[] => {
      return [...readOnly].filter((name) => {
        return Object.hasOwn(roots, name);
      });
    },
    rootNames: (): string[] => {
      return Object.keys(roots);
    },
    allowedNames: (): string[] => {
      return [...allowed].filter(usable);
    },
    async handle(msg: ToolRequest, send: (m: TunnelMessage) => void): Promise<void> {
      const started = Date.now();
      const finish = (ok: boolean, output: string, outcome: AuditEntry["outcome"], summary: string, change?: FileChange): void => {
        send({ type: "tool-result", id: msg.id, ok, output, ...(change ? { change } : {}) });
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
      const cwd = Object.hasOwn(roots, msg.root) ? roots[msg.root] : undefined;
      if (!cwd) {
        finish(false, `unknown project root "${msg.root}"`, "refused", summary);
        return;
      }
      // A tool for the gateway's own use is allowed wherever the device allows any of its own tools.
      const permitted = tool !== undefined && (allowed.has(msg.name) || (tool.hidden === true && [...allowed].some((n) => {
        return findTool(n)?.group === "device";
      })));
      if (!tool || !permitted) {
        finish(false, `tool "${msg.name}" is not allowed on this device`, "refused", summary);
        return;
      }
      // Running a command, writing, editing or committing could change a folder that must stay as it is, and a command cannot be
      // fenced in, so none of them runs there.
      if (readOnly.has(msg.root) && tool.group === "device" && tool.level === "change") {
        finish(false, `project root "${msg.root}" is read-only on this device, so ${msg.name} is not allowed there`, "refused", summary);
        return;
      }
      if (!usable(msg.name)) {
        finish(false, `${tool.requires ?? msg.name} is not installed on this device`, "refused", summary);
        return;
      }
      try {
        // What a write or edit changed goes beside the result, for the person; the model only gets the result.
        let change: FileChange | undefined;
        const output = truncate(await tool.run(msg.args, { cwd, report: (c) => {
          change = c;
        } }));
        finish(true, output, "ok", summary, change);
      } catch (err) {
        finish(false, (err as Error).message, "error", summary);
      }
    },
  };
};

export type ToolServer = ReturnType<typeof createToolServer>;
