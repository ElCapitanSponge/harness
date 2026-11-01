import { HEARTBEAT_INTERVAL_MS, RelayRequest, TUNNEL_PATH, authHeaders, rawToString, type Heartbeat, type TunnelMessage } from "@harness/core";
import { WebSocket } from "ws";
import type { ChatServer } from "./chat.js";
import type { ClaudeServer } from "./claude.js";
import type { ModelServer } from "./models.js";
import type { ToolServer } from "./toolserver.js";

export const tunnelUrl = (gatewayUrl: string): string => {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = TUNNEL_PATH;
  return url.toString();
};

interface TunnelOptions {
  gatewayUrl: string;
  apiKey?: string;
  heartbeat: () => Promise<Heartbeat>;
  chat?: ChatServer;
  tools?: ToolServer;
  claude?: ClaudeServer;
  models?: ModelServer;
  intervalMs?: number;
  minRetryMs?: number;
  maxRetryMs?: number;
  log?: (message: string) => void;
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Dials out to the gateway and keeps the connection open, reconnecting with backoff, so this device
// needs no inbound port. Heartbeats go over the connection; the gateway lists the device while it is open.
export const connectTunnel = (opts: TunnelOptions): { close(): void } => {
  const { intervalMs = HEARTBEAT_INTERVAL_MS, minRetryMs = 1000, maxRetryMs = 30_000, log = console.warn } = opts;
  const url = tunnelUrl(opts.gatewayUrl);
  let stopped = false;
  let ws: WebSocket | undefined;
  let beatTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let delay = minRetryMs;
  let lastError = "";

  const beat = async (socket: WebSocket): Promise<void> => {
    try {
      const heartbeat = await opts.heartbeat();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "heartbeat", heartbeat }));
      }
    } catch (err) {
      log(`[agent] heartbeat failed: ${(err as Error).message}`);
    }
  };

  const connect = (): void => {
    const socket = new WebSocket(url, { headers: authHeaders(opts.apiKey) });
    ws = socket;
    socket.on("open", () => {
      delay = minRetryMs;
      lastError = "";
      void beat(socket);
      beatTimer = setInterval(() => {
        return void beat(socket);
      }, intervalMs);
    });
    socket.on("message", (data) => {
      const parsed = RelayRequest.safeParse(safeJson(rawToString(data)));
      if (!parsed.success) {
        return;
      }
      const send = (msg: TunnelMessage): void => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };
      if (parsed.data.type === "tool") {
        void opts.tools?.handle(parsed.data, send);
      } else if (parsed.data.type === "claude") {
        void opts.claude?.handle(parsed.data, send);
      } else if (parsed.data.type === "model") {
        void opts.models?.handle(parsed.data, send);
      } else {
        opts.chat?.handle(parsed.data, send);
      }
    });
    socket.on("error", (err) => {
      // Report a given failure once, not on every retry.
      if (err.message === lastError) {
        return;
      }
      lastError = err.message;
      log(err.message.includes("401") ? "[agent] gateway rejected the API key (set HARNESS_API_KEY)" : `[agent] gateway unreachable: ${err.message}`);
    });
    socket.on("close", () => {
      clearInterval(beatTimer);
      opts.chat?.cancelAll();
      if (stopped) {
        return;
      }
      retryTimer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, maxRetryMs);
    });
  };

  connect();

  return {
    close() {
      stopped = true;
      clearInterval(beatTimer);
      clearTimeout(retryTimer);
      ws?.terminate();
    },
  };
};
