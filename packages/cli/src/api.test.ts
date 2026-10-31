import { describe, expect, it, vi } from "vitest";
import { Gateway } from "./api.js";
import { loadArgs, unloadArgs } from "./lms.js";

const respond = (body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) =>
  vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    headers: new Headers(init.headers),
  }) as unknown as typeof fetch;

describe("Gateway.chat", () => {
  const msgs = [{ role: "user" as const, content: "hi" }];

  it("returns the text, model and serving node", async () => {
    const f = respond({ model: "qwen", choices: [{ message: { content: "hello" } }] }, { headers: { "x-harness-node": "anakin" } });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).resolves.toEqual({ text: "hello", model: "qwen", node: "anakin" });
  });

  it("surfaces the gateway's error message", async () => {
    const f = respond({ error: { message: "no idle node" } }, { ok: false, status: 503 });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).rejects.toThrow("no idle node");
  });

  it("falls back to the status code when the error body is empty", async () => {
    const f = respond({}, { ok: false, status: 500 });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).rejects.toThrow("500");
  });

  it("throws when a successful response has no completion", async () => {
    await expect(new Gateway("http://g", respond({ choices: [] })).chat("auto", msgs)).rejects.toThrow("no completion");
  });
});

describe("Gateway.nodes", () => {
  it("returns the node list", async () => {
    const nodes = [{ nodeId: "pc" }];
    await expect(new Gateway("http://g", respond(nodes)).nodes()).resolves.toEqual(nodes);
  });

  it("throws on a failed response", async () => {
    await expect(new Gateway("http://g", respond([], { ok: false, status: 502 })).nodes()).rejects.toThrow("502");
  });
});

describe("lms arguments", () => {
  it("builds load args with an optional context length", () => {
    expect(loadArgs("m")).toEqual(["load", "m", "-y"]);
    expect(loadArgs("m", 32768)).toEqual(["load", "m", "-y", "-c", "32768"]);
  });

  it("unloads one model or all", () => {
    expect(unloadArgs("m")).toEqual(["unload", "m"]);
    expect(unloadArgs()).toEqual(["unload", "--all"]);
  });
});
