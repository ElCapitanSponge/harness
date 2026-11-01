import { randomUUID } from "node:crypto";
import type { FileChange, RelayRequest, TunnelMessage } from "@harness/core";

export interface Sender {
  send(data: string): void;
}

type Reply = Exclude<TunnelMessage, { type: "heartbeat" }>;

export interface ToolResult {
  ok: boolean;
  output: string;
  // What a write or edit changed, for the person to see. Never part of what the model is told.
  change?: FileChange;
}

interface PendingTool {
  nodeId: string;
  settle(result: ToolResult | Error): void;
}

const TOOL_TIMEOUT_MS = 150_000;
const CLAUDE_TIMEOUT_MS = 10 * 60_000;
// Loading a large model can take a few minutes.
const MODEL_TIMEOUT_MS = 6 * 60_000;
const SETTINGS_TIMEOUT_MS = 15_000;

interface Pending {
  nodeId: string;
  started: boolean;
  head(status: number, contentType?: string): void;
  chunk(data: string): void;
  end(): void;
  fail(message: string): void;
}

// Sends a request down a device's tunnel and hands back its reply as an ordinary streaming Response.
export class Relay {
  private senders = new Map<string, Sender>();
  private pending = new Map<string, Pending>();
  private tools = new Map<string, PendingTool>();

  attach(nodeId: string, sender: Sender): void {
    this.senders.set(nodeId, sender);
  }

  // Only the current connection for a device may detach it; anything still waiting on it is failed.
  detach(nodeId: string, sender: Sender): void {
    if (this.senders.get(nodeId) !== sender) {
      return;
    }
    this.senders.delete(nodeId);
    for (const [id, p] of this.pending) {
      if (p.nodeId !== nodeId) {
        continue;
      }
      this.pending.delete(id);
      p.fail("tunnel closed");
    }
    for (const [id, t] of this.tools) {
      if (t.nodeId !== nodeId) {
        continue;
      }
      this.tools.delete(id);
      t.settle(new Error("tunnel closed"));
    }
  }

  connected(nodeId: string): boolean {
    return this.senders.has(nodeId);
  }

  request(nodeId: string, body: string, signal?: AbortSignal): Promise<Response> {
    const sender = this.senders.get(nodeId);
    if (!sender) {
      return Promise.reject(new Error("not connected"));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("cancelled"));
    }
    const id = randomUUID();
    const encoder = new TextEncoder();

    return new Promise<Response>((resolve, reject) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => {
          controller = c;
        },
        cancel: () => {
          if (!this.pending.delete(id)) {
            return;
          }
          sender.send(JSON.stringify({ type: "cancel", id } satisfies RelayRequest));
        },
      });
      const pending: Pending = {
        nodeId,
        started: false,
        head: (status, contentType) => {
          pending.started = true;
          resolve(new Response(stream, { status, headers: { "content-type": contentType ?? "application/json" } }));
        },
        chunk: (data) => {
          controller.enqueue(encoder.encode(data));
        },
        end: () => {
          controller.close();
        },
        fail: (message) => {
          if (pending.started) {
            controller.error(new Error(message));
          } else {
            reject(new Error(message));
          }
        },
      };
      this.pending.set(id, pending);
      sender.send(JSON.stringify({ type: "request", id, body } satisfies RelayRequest));

      // Abandoning the request tells the device to stop, and ends the stream if it had started.
      signal?.addEventListener(
        "abort",
        () => {
          if (!this.pending.delete(id)) {
            return;
          }
          sender.send(JSON.stringify({ type: "cancel", id } satisfies RelayRequest));
          const reason = new Error("cancelled");
          if (pending.started) {
            controller.error(reason);
          } else {
            reject(reason);
          }
        },
        { once: true },
      );
    });
  }

  // Runs one tool on a device, inside one of its configured project roots.
  callTool(nodeId: string, root: string, name: string, args: Record<string, unknown>, opts: { session?: string; timeoutMs?: number } = {}): Promise<ToolResult> {
    return this.rpc(nodeId, (id) => {
      return { type: "tool", id, root, name, args, session: opts.session };
    }, opts.timeoutMs ?? TOOL_TIMEOUT_MS);
  }

  // Asks a device that is logged in to Claude to answer a chat request. `body` is the raw request JSON.
  callClaude(nodeId: string, body: string, timeoutMs = CLAUDE_TIMEOUT_MS): Promise<ToolResult> {
    return this.rpc(nodeId, (id) => {
      return { type: "claude", id, body };
    }, timeoutMs);
  }

  // Loads or unloads a model in a device's LM Studio.
  callModel(nodeId: string, op: "load" | "unload", model?: string, contextLength?: number): Promise<ToolResult> {
    return this.rpc(nodeId, (id) => {
      return { type: "model", id, op, model, contextLength };
    }, MODEL_TIMEOUT_MS);
  }

  // Reads or changes a device's settings. The device decides whether to accept a change.
  callSettings(nodeId: string, op: "get" | "set", settings?: Record<string, unknown>): Promise<ToolResult> {
    return this.rpc(nodeId, (id) => {
      return { type: "settings", id, op, settings };
    }, SETTINGS_TIMEOUT_MS);
  }

  private rpc(nodeId: string, message: (id: string) => RelayRequest, timeoutMs: number): Promise<ToolResult> {
    const sender = this.senders.get(nodeId);
    if (!sender) {
      return Promise.reject(new Error("not connected"));
    }
    const id = randomUUID();
    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.tools.delete(id);
        reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);
      this.tools.set(id, {
        nodeId,
        settle: (result) => {
          clearTimeout(timer);
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result);
          }
        },
      });
      sender.send(JSON.stringify(message(id)));
    });
  }

  // A device may only answer requests that were sent to it.
  handle(nodeId: string, msg: Reply): void {
    if (msg.type === "tool-result") {
      const tool = this.tools.get(msg.id);
      if (tool?.nodeId !== nodeId) {
        return;
      }
      this.tools.delete(msg.id);
      tool.settle({ ok: msg.ok, output: msg.output, ...(msg.change ? { change: msg.change } : {}) });
      return;
    }
    const pending = this.pending.get(msg.id);
    if (pending?.nodeId !== nodeId) {
      return;
    }
    switch (msg.type) {
      case "head":
        pending.head(msg.status, msg.contentType);
        return;
      case "chunk":
        pending.chunk(msg.data);
        return;
      case "end":
        this.pending.delete(msg.id);
        pending.end();
        return;
      case "fail":
        this.pending.delete(msg.id);
        pending.fail(msg.message);
        return;
    }
  }
}
