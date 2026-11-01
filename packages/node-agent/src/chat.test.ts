import type { TunnelMessage } from "@harness/core";
import { describe, expect, it } from "vitest";
import { createChatServer } from "./chat.js";

const sse = (chunks: string[]): Response =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const chunk of chunks) c.enqueue(enc.encode(chunk));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("createChatServer", () => {
  it("calls only the local chat endpoint and streams head, chunks and end back", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return sse(["data: one\n\n", "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const out: TunnelMessage[] = [];
    const server = createChatServer({ inferenceUrl: "http://localhost:1234", fetchImpl });

    server.handle({ type: "request", id: "r1", body: '{"model":"qwen"}' }, (m) => out.push(m));
    await until(() => out.some((m) => m.type === "end"));

    expect(calls).toEqual([{ url: "http://localhost:1234/v1/chat/completions", body: '{"model":"qwen"}' }]);
    expect(out[0]).toEqual({ type: "head", id: "r1", status: 200, contentType: "text/event-stream" });
    const text = out.filter((m) => m.type === "chunk").map((m) => (m as { data: string }).data).join("");
    expect(text).toBe("data: one\n\ndata: [DONE]\n\n");
  });

  it("does not split a multi-byte character across chunks", async () => {
    const bytes = new TextEncoder().encode("héllo ✓");
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const b of bytes) c.enqueue(Uint8Array.of(b));
            c.close();
          },
        }),
      )) as unknown as typeof fetch;
    const out: TunnelMessage[] = [];
    createChatServer({ inferenceUrl: "http://x", fetchImpl }).handle({ type: "request", id: "r", body: "{}" }, (m) => out.push(m));
    await until(() => out.some((m) => m.type === "end"));
    expect(out.filter((m) => m.type === "chunk").map((m) => (m as { data: string }).data).join("")).toBe("héllo ✓");
  });

  it("reports a failure when the model server is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const out: TunnelMessage[] = [];
    createChatServer({ inferenceUrl: "http://x", fetchImpl }).handle({ type: "request", id: "r", body: "{}" }, (m) => out.push(m));
    await until(() => out.length > 0);
    expect(out).toEqual([{ type: "fail", id: "r", message: "ECONNREFUSED" }]);
  });

  it("aborts the model request on cancel and sends nothing more", async () => {
    let aborted = false;
    const fetchImpl = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const out: TunnelMessage[] = [];
    const server = createChatServer({ inferenceUrl: "http://x", fetchImpl });
    server.handle({ type: "request", id: "r", body: "{}" }, (m) => out.push(m));
    server.handle({ type: "cancel", id: "r" }, (m) => out.push(m));
    await until(() => aborted);
    await new Promise((r) => setTimeout(r, 20));
    expect(out).toEqual([]);
  });

  it("cancels every in-flight request when the tunnel drops", async () => {
    let aborts = 0;
    const fetchImpl = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborts++;
          reject(new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const server = createChatServer({ inferenceUrl: "http://x", fetchImpl });
    server.handle({ type: "request", id: "a", body: "{}" }, () => undefined);
    server.handle({ type: "request", id: "b", body: "{}" }, () => undefined);
    server.cancelAll();
    await until(() => aborts === 2);
  });
});
