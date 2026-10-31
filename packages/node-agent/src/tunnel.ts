import { HEARTBEAT_INTERVAL_MS, TUNNEL_PATH, authHeaders, type Heartbeat } from "@harness/core";
import { WebSocket } from "ws";

export function tunnelUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = TUNNEL_PATH;
  return url.toString();
}

interface TunnelOptions {
  gatewayUrl: string;
  apiKey?: string;
  heartbeat: () => Promise<Heartbeat>;
  intervalMs?: number;
  minRetryMs?: number;
  maxRetryMs?: number;
  log?: (message: string) => void;
}

// Dials out to the gateway and keeps the connection open, reconnecting with backoff, so this device
// needs no inbound port. Heartbeats go over the connection; the gateway lists the device while it is open.
export function connectTunnel(opts: TunnelOptions): { close(): void } {
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
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat", heartbeat }));
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
      beatTimer = setInterval(() => void beat(socket), intervalMs);
    });
    socket.on("error", (err) => {
      // Report a given failure once, not on every retry.
      if (err.message === lastError) return;
      lastError = err.message;
      log(err.message.includes("401") ? "[agent] gateway rejected the API key (set HARNESS_API_KEY)" : `[agent] gateway unreachable: ${err.message}`);
    });
    socket.on("close", () => {
      clearInterval(beatTimer);
      if (stopped) return;
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
}
