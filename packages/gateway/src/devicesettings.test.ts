import type { Heartbeat } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { Registry } from "./registry.js";
import { Sessions } from "./sessions.js";

const build = (callSettings = vi.fn()) => {
  const registry = new Registry();
  registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [] } satisfies Heartbeat);
  const app = createApp({
    registry,
    relay: { request: vi.fn(), callTool: vi.fn(), callClaude: vi.fn(), callModel: vi.fn(), callSettings },
    loader: { ensure: vi.fn() },
    sessions: new Sessions({ registry, relay: { callTool: vi.fn() }, complete: vi.fn() }),
  });
  return { app, callSettings };
};
const put = (body: unknown): RequestInit => {
  return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
};

describe("device settings routes", () => {
  it("read a device's settings through the tunnel", async () => {
    const report = { settings: {}, sources: {}, locked: [], remoteConfig: true };
    const { app, callSettings } = build(vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify(report) });
    }));
    const res = await app.request("/devices/pc/settings");
    expect(await res.json()).toEqual(report);
    expect(callSettings).toHaveBeenCalledWith("pc", "get", undefined);
  });

  it("pass a change down and return the device's new settings", async () => {
    const { app, callSettings } = build(vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify({ remoteConfig: true }) });
    }));
    const res = await app.request("/devices/pc/settings", put({ claude: true }));
    expect(res.status).toBe(200);
    expect(callSettings).toHaveBeenCalledWith("pc", "set", { claude: true });
  });

  it("show the device's reason when it refuses a change", async () => {
    const { app } = build(vi.fn(() => {
      return Promise.resolve({ ok: false, output: "this device does not accept remote settings changes" });
    }));
    const res = await app.request("/devices/pc/settings", put({ claude: true }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { message: "this device does not accept remote settings changes" } });
  });

  it("refuse a device that is not connected and a body that is not an object", async () => {
    const { app } = build();
    expect((await app.request("/devices/other/settings")).status).toBe(404);
    expect((await app.request("/devices/pc/settings", put([1]))).status).toBe(400);
  });

  it("report a device that does not answer", async () => {
    const { app } = build(vi.fn(() => {
      return Promise.reject(new Error("timed out after 15 seconds"));
    }));
    expect((await app.request("/devices/pc/settings")).status).toBe(502);
  });
});
