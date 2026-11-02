import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { TUNNEL_PATH, TunnelMessage, rawToString } from "@harness/core";
import { type WebSocket, WebSocketServer } from "ws";
import { normalizeAddress } from "./address.js";
import { safeEqual } from "./auth.js";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";

const PING_INTERVAL_MS = 15_000;

const authorized = (req: IncomingMessage, apiKey?: string): boolean => {
  if (!apiKey) {
    return true;
  }
  const header = req.headers.authorization ?? "";
  return safeEqual(header.startsWith("Bearer ") ? header.slice(7) : "", apiKey);
};

const reject = (socket: Duplex, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

// Devices dial out to the gateway and hold this connection, so they need no inbound port.
// A device is listed while its connection is open and is removed as soon as it closes.
export const attachTunnel = (server: Server, opts: { registry: Registry; relay: Relay; apiKey?: string }): { close(): void } => {
  const wss = new WebSocketServer({ noServer: true });
  const owner = new Map<string, WebSocket>();
  const alive = new WeakSet<WebSocket>();

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== TUNNEL_PATH) {
      reject(socket, "404 Not Found");
      return;
    }
    if (!authorized(req, opts.apiKey)) {
      reject(socket, "401 Unauthorized");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      return wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const address = normalizeAddress(req.socket.remoteAddress);
    let nodeId: string | undefined;
    const sender = { send: (data: string) => {
      ws.send(data);
    } };
    alive.add(ws);
    ws.on("pong", () => {
      return alive.add(ws);
    });
    ws.on("message", (data) => {
      let msg: TunnelMessage;
      try {
        msg = TunnelMessage.parse(JSON.parse(rawToString(data)));
      } catch {
        ws.close(1008, "invalid message");
        return;
      }
      if (msg.type !== "heartbeat") {
        // Replies are only accepted from a device that has already identified itself.
        if (!nodeId) {
          ws.close(1008, "heartbeat required first");
          return;
        }
        opts.relay.handle(nodeId, msg);
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
        opts.relay.attach(id, sender);
        previous?.terminate();
      }
      opts.registry.upsert(msg.heartbeat, address);
    });
    ws.on("close", () => {
      if (nodeId && owner.get(nodeId) === ws) {
        owner.delete(nodeId);
        opts.registry.remove(nodeId);
      }
      if (nodeId) {
        opts.relay.detach(nodeId, sender);
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
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close();
    },
  };
};
