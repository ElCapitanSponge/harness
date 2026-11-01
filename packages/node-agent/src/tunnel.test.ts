import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rawToString, type Heartbeat } from "@harness/core";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { connectTunnel, tunnelUrl } from "./tunnel.js";

const heartbeat = async (): Promise<Heartbeat> => {
  return { nodeId: "pc", kind: "local", busy: false, models: [] };
};

describe("tunnelUrl", () => {
  it("maps http to ws and https to wss and points at the tunnel path", () => {
    expect(tunnelUrl("http://gw:8787")).toBe("ws://gw:8787/tunnel");
    expect(tunnelUrl("https://gw.tailnet.ts.net/")).toBe("wss://gw.tailnet.ts.net/tunnel");
  });
});

let server: Server;
let wss: WebSocketServer;
let tunnel: { close(): void } | undefined;
let seen: { auth?: string; sockets: WebSocket[]; messages: unknown[] };

const gateway = async (port = 0): Promise<number> => {
  server = createServer();
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    seen.auth = req.headers.authorization;
    seen.sockets.push(ws);
    ws.on("message", (data) => {
      return seen.messages.push(JSON.parse(rawToString(data)));
    });
  });
  await new Promise<void>((resolve) => {
    return server.listen(port, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
};

const stopGateway = async (): Promise<void> => {
  for (const ws of wss.clients) {
    ws.terminate();
  }
  wss.close();
  await new Promise((resolve) => {
    return server.close(resolve);
  });
};

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 10);
    });
  }
  expect(check()).toBe(true);
};

describe("connectTunnel", () => {
  afterEach(async () => {
    tunnel?.close();
    tunnel = undefined;
    await stopGateway();
  });

  it("connects with the bearer key and sends a heartbeat straight away, then on the interval", async () => {
    seen = { sockets: [], messages: [] };
    const port = await gateway();
    tunnel = connectTunnel({ gatewayUrl: `http://127.0.0.1:${port}`, apiKey: "k", heartbeat, intervalMs: 30 });

    await until(() => {
      return seen.messages.length >= 3;
    });
    expect(seen.auth).toBe("Bearer k");
    expect(seen.messages[0]).toMatchObject({ type: "heartbeat", heartbeat: { nodeId: "pc" } });
  });

  it("reconnects with backoff after the gateway drops the connection", async () => {
    seen = { sockets: [], messages: [] };
    const port = await gateway();
    tunnel = connectTunnel({ gatewayUrl: `http://127.0.0.1:${port}`, heartbeat, intervalMs: 1000, minRetryMs: 20, maxRetryMs: 40 });
    await until(() => {
      return seen.sockets.length === 1;
    });

    seen.sockets[0]?.terminate();
    await until(() => {
      return seen.sockets.length === 2;
    });
  });

  it("keeps retrying while the gateway is down and connects once it is back, logging the failure once", async () => {
    seen = { sockets: [], messages: [] };
    const port = await gateway();
    await stopGateway();

    const logs: string[] = [];
    tunnel = connectTunnel({ gatewayUrl: `http://127.0.0.1:${port}`, heartbeat, minRetryMs: 10, maxRetryMs: 20, log: (m) => {
      return logs.push(m);
    } });
    await new Promise((r) => {
      return setTimeout(r, 150);
    });
    expect(logs.length).toBe(1);
    // The port was just freed, so another test's server may take it and answer with something else; what matters is one report.
    expect(logs[0]).toContain("[agent] gateway");

    await gateway(port);
    await until(() => {
      return seen.sockets.length === 1;
    });
  });

  it("stops reconnecting once closed", async () => {
    seen = { sockets: [], messages: [] };
    const port = await gateway();
    tunnel = connectTunnel({ gatewayUrl: `http://127.0.0.1:${port}`, heartbeat, minRetryMs: 10 });
    await until(() => {
      return seen.sockets.length === 1;
    });

    tunnel.close();
    await new Promise((r) => {
      return setTimeout(r, 100);
    });
    expect(seen.sockets.length).toBe(1);
  });
});
