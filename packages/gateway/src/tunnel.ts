import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { TUNNEL_PATH, TunnelMessage } from "@harness/core";
import { type WebSocket, WebSocketServer } from "ws";
import { safeEqual } from "./auth.js";
import type { Registry } from "./registry.js";

const PING_INTERVAL_MS = 15_000;

function authorized(req: IncomingMessage, apiKey?: string): boolean {
  if (!apiKey) return true;
  const header = req.headers.authorization ?? "";
  return safeEqual(header.startsWith("Bearer ") ? header.slice(7) : "", apiKey);
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// Devices dial out to the gateway and hold this connection, so they need no inbound port.
// A device is listed while its connection is open and is removed as soon as it closes.
export function attachTunnel(server: Server, opts: { registry: Registry; apiKey?: string }): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const owner = new Map<string, WebSocket>();
  const alive = new WeakSet<WebSocket>();

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== TUNNEL_PATH) return reject(socket, "404 Not Found");
    if (!authorized(req, opts.apiKey)) return reject(socket, "401 Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    let nodeId: string | undefined;
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    ws.on("message", (data) => {
      let msg: TunnelMessage;
      try {
        msg = TunnelMessage.parse(JSON.parse(data.toString()));
      } catch {
        ws.close(1008, "invalid message");
        return;
      }
      const id = msg.heartbeat.nodeId;
      if (nodeId && nodeId !== id) {
        ws.close(1008, "node id changed");
        return;
      }
      if (!nodeId) {
        nodeId = id;
        const previous = owner.get(id);
        owner.set(id, ws);
        previous?.terminate();
      }
      opts.registry.upsert(msg.heartbeat);
    });
    ws.on("close", () => {
      if (nodeId && owner.get(nodeId) === ws) {
        owner.delete(nodeId);
        opts.registry.remove(nodeId);
      }
    });
  });

  // Drop connections that stop answering pings, so a vanished device does not linger.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_INTERVAL_MS);
  timer.unref();

  return {
    close() {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
