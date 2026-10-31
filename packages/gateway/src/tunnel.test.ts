import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Heartbeat } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Registry } from "./registry.js";
import { attachTunnel } from "./tunnel.js";

const beat = (nodeId = "pc"): string =>
  JSON.stringify({
    type: "heartbeat",
    heartbeat: { nodeId, kind: "local", baseUrl: "http://localhost:1234", busy: false, models: [{ id: "qwen", loaded: true }] } satisfies Heartbeat,
  });

let server: Server;
let tunnel: { close(): void };
let registry: Registry;
let port: number;
const sockets: WebSocket[] = [];

async function start(apiKey?: string): Promise<void> {
  server = createServer();
  tunnel = attachTunnel(server, { registry, apiKey });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
}

function dial(path = "/tunnel", headers: Record<string, string> = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

const closed = (ws: WebSocket): Promise<number> => new Promise((resolve) => ws.once("close", (code) => resolve(code)));
const ids = (): string[] => registry.live().map((n) => n.nodeId);

beforeEach(() => {
  registry = new Registry();
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  tunnel.close();
  await new Promise((resolve) => server.close(resolve));
});

describe("tunnel auth", () => {
  it("refuses a connection with no key or the wrong key", async () => {
    await start("secret");
    await expect(dial()).rejects.toThrow(/401/);
    await expect(dial("/tunnel", { authorization: "Bearer nope" })).rejects.toThrow(/401/);
    expect(ids()).toEqual([]);
  });

  it("accepts the right key", async () => {
    await start("secret");
    const ws = await dial("/tunnel", { authorization: "Bearer secret" });
    ws.send(beat());
    await until(() => ids().includes("pc"));
  });

  it("allows connections when no key is configured", async () => {
    await start();
    await dial();
  });

  it("refuses any other path", async () => {
    await start();
    await expect(dial("/elsewhere")).rejects.toThrow(/404/);
  });
});

describe("tunnel registration", () => {
  it("lists a device while its connection is open and removes it when it closes", async () => {
    await start();
    const ws = await dial();
    ws.send(beat());
    await until(() => ids().includes("pc"));
    expect(registry.live()[0]?.models).toEqual([{ id: "qwen", loaded: true }]);

    ws.close();
    await until(() => ids().length === 0);
  });

  it("closes the connection on a malformed message and lists nothing", async () => {
    await start();
    const ws = await dial();
    const code = closed(ws);
    ws.send("not json");
    expect(await code).toBe(1008);
    expect(ids()).toEqual([]);
  });

  it("closes the connection if the device changes its node id", async () => {
    await start();
    const ws = await dial();
    const code = closed(ws);
    ws.send(beat("a"));
    await until(() => ids().includes("a"));
    ws.send(beat("b"));
    expect(await code).toBe(1008);
    await until(() => ids().length === 0);
  });

  it("lets a reconnect replace the old connection without being removed when the old one closes", async () => {
    await start();
    const first = await dial();
    first.send(beat());
    await until(() => ids().includes("pc"));

    const second = await dial();
    const firstClosed = closed(first);
    second.send(beat());
    await firstClosed;
    await new Promise((r) => setTimeout(r, 50));
    expect(ids()).toEqual(["pc"]);
  });
});
