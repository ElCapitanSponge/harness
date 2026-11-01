import { beforeEach, describe, expect, it } from "vitest";
import { Relay, type Sender } from "./relay.js";

let relay: Relay;
let sent: Record<string, unknown>[];
let sender: Sender;

beforeEach(() => {
  relay = new Relay();
  sent = [];
  sender = { send: (data) => {
    return sent.push(JSON.parse(data) as Record<string, unknown>);
  } };
  relay.attach("pc", sender);
});

const lastId = (): string => {
  return sent.at(-1)!.id as string;
};

describe("Relay tools", () => {
  it("sends a tool call down the tunnel and resolves with the device's result", async () => {
    const pending = relay.callTool("pc", "proj", "read_file", { path: "a.txt" });
    expect(sent[0]).toMatchObject({ type: "tool", root: "proj", name: "read_file", args: { path: "a.txt" } });
    relay.handle("pc", { type: "tool-result", id: lastId(), ok: true, output: "contents" });
    expect(await pending).toEqual({ ok: true, output: "contents" });
  });

  it("rejects when the device is not connected", async () => {
    await expect(relay.callTool("laptop", "proj", "read_file", {})).rejects.toThrow("not connected");
  });

  it("rejects when the tunnel closes while waiting", async () => {
    const pending = relay.callTool("pc", "proj", "read_file", {});
    relay.detach("pc", sender);
    await expect(pending).rejects.toThrow("tunnel closed");
  });

  it("rejects after the timeout", async () => {
    await expect(relay.callTool("pc", "proj", "read_file", {}, { timeoutMs: 20 })).rejects.toThrow("timed out");
  });

  it("ignores a result that comes from a different device", async () => {
    relay.attach("laptop", { send: () => {
      return undefined;
    } });
    const pending = relay.callTool("pc", "proj", "read_file", {}, { timeoutMs: 50 });
    relay.handle("laptop", { type: "tool-result", id: lastId(), ok: true, output: "forged" });
    await expect(pending).rejects.toThrow("timed out");
  });
});

describe("Relay model control", () => {
  it("sends the operation to the device and resolves with its answer", async () => {
    const pending = relay.callModel("pc", "load", "qwen", 8192);
    expect(sent[0]).toMatchObject({ type: "model", op: "load", model: "qwen", contextLength: 8192 });
    relay.handle("pc", { type: "tool-result", id: lastId(), ok: true, output: "loaded qwen" });
    expect(await pending).toEqual({ ok: true, output: "loaded qwen" });
  });

  it("rejects when the device is not connected", async () => {
    await expect(relay.callModel("laptop", "unload")).rejects.toThrow("not connected");
  });
});

describe("Relay Claude requests", () => {
  it("sends the request body to the device and resolves with its answer", async () => {
    const pending = relay.callClaude("pc", "{\"model\":\"claude\"}");
    expect(sent[0]).toMatchObject({ type: "claude", body: "{\"model\":\"claude\"}" });
    relay.handle("pc", { type: "tool-result", id: lastId(), ok: true, output: "{\"text\":\"pong\"}" });
    expect(await pending).toEqual({ ok: true, output: "{\"text\":\"pong\"}" });
  });

  it("rejects when the device is not connected, or its tunnel closes while waiting", async () => {
    await expect(relay.callClaude("laptop", "{}")).rejects.toThrow("not connected");
    const pending = relay.callClaude("pc", "{}");
    relay.detach("pc", sender);
    await expect(pending).rejects.toThrow("tunnel closed");
  });

  it("gives up after the timeout", async () => {
    await expect(relay.callClaude("pc", "{}", 20)).rejects.toThrow("timed out");
  });
});

describe("Relay", () => {
  it("rejects when the device is not connected", async () => {
    await expect(relay.request("laptop", "{}")).rejects.toThrow("not connected");
  });

  it("sends the request down the tunnel and streams the reply back as a Response", async () => {
    const pending = relay.request("pc", "{\"model\":\"qwen\"}");
    expect(sent[0]).toMatchObject({ type: "request", body: "{\"model\":\"qwen\"}" });
    const id = lastId();

    relay.handle("pc", { type: "head", id, status: 200, contentType: "text/event-stream" });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    relay.handle("pc", { type: "chunk", id, data: "data: a\n\n" });
    relay.handle("pc", { type: "chunk", id, data: "data: [DONE]\n\n" });
    relay.handle("pc", { type: "end", id });
    expect(await res.text()).toBe("data: a\n\ndata: [DONE]\n\n");
  });

  it("passes through a non-200 status from the device's model server", async () => {
    const pending = relay.request("pc", "{}");
    const id = lastId();
    relay.handle("pc", { type: "head", id, status: 400 });
    relay.handle("pc", { type: "chunk", id, data: "{\"error\":\"bad\"}" });
    relay.handle("pc", { type: "end", id });
    const res = await pending;
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe("{\"error\":\"bad\"}");
  });

  it("rejects when the device fails before sending a reply", async () => {
    const pending = relay.request("pc", "{}");
    relay.handle("pc", { type: "fail", id: lastId(), message: "connection refused" });
    await expect(pending).rejects.toThrow("connection refused");
  });

  it("errors the stream when the device fails part-way through", async () => {
    const pending = relay.request("pc", "{}");
    const id = lastId();
    relay.handle("pc", { type: "head", id, status: 200 });
    const res = await pending;
    relay.handle("pc", { type: "chunk", id, data: "partial" });
    relay.handle("pc", { type: "fail", id, message: "model crashed" });
    await expect(res.text()).rejects.toThrow("model crashed");
  });

  it("fails everything waiting on a device when its tunnel closes", async () => {
    const waiting = relay.request("pc", "{}");
    const streaming = relay.request("pc", "{}");
    relay.handle("pc", { type: "head", id: lastId(), status: 200 });
    const res = await streaming;

    relay.detach("pc", sender);
    await expect(waiting).rejects.toThrow("tunnel closed");
    await expect(res.text()).rejects.toThrow("tunnel closed");
    expect(relay.connected("pc")).toBe(false);
  });

  it("ignores a detach from a connection that has since been replaced", async () => {
    const newer: Sender = { send: () => {
      return undefined;
    } };
    relay.attach("pc", newer);
    relay.detach("pc", sender);
    expect(relay.connected("pc")).toBe(true);
  });

  it("tells the device to cancel when the caller abandons the response", async () => {
    const pending = relay.request("pc", "{}");
    const id = lastId();
    relay.handle("pc", { type: "head", id, status: 200 });
    const res = await pending;
    await res.body!.cancel();
    expect(sent.at(-1)).toEqual({ type: "cancel", id });
  });

  it("does not send a request whose signal is already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(relay.request("pc", "{}", abort.signal)).rejects.toThrow("cancelled");
    expect(sent).toEqual([]);
  });

  it("ignores replies for unknown ids and replies from a different device", async () => {
    relay.attach("laptop", { send: () => {
      return undefined;
    } });
    const pending = relay.request("pc", "{}");
    const id = lastId();
    relay.handle("laptop", { type: "head", id, status: 200 });
    relay.handle("pc", { type: "head", id: "nope", status: 200 });

    let settled = false;
    void pending.then(() => {
      return (settled = true);
    });
    await new Promise((r) => {
      return setTimeout(r, 20);
    });
    expect(settled).toBe(false);

    relay.handle("pc", { type: "head", id, status: 200 });
    expect((await pending).status).toBe(200);
  });
});
