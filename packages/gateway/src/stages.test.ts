import type { ChatMessage, Heartbeat, StageName } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import type { LoadStage } from "./loader.js";
import { Registry } from "./registry.js";
import { createCompleter } from "./sessions.js";

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
const signal = new AbortController().signal;

const sse = (...deltas: object[]): Response => {
  const body = deltas.map((d) => {
    return `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
  }).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};

const record = () => {
  const seen: string[] = [];
  return {
    seen,
    hooks: {
      stage: (stage: StageName, detail?: string) => {
        seen.push(detail ? `${stage}:${detail}` : stage);
      },
    },
  };
};

describe("progress stages", () => {
  it("run in order for a model that has to be loaded: routing, loading, waiting, thinking, writing", async () => {
    const registry = new Registry();
    registry.upsert({ nodeId: "pc", kind: "local", busy: false, modelControl: true, models: [{ id: "qwen", loaded: false }] } satisfies Heartbeat);
    const ensure = vi.fn((_target: unknown, onStage?: (s: LoadStage) => void) => {
      onStage?.({ type: "loading", model: "qwen", contextLength: 32_768 });
      registry.upsert({ nodeId: "pc", kind: "local", busy: false, modelControl: true, models: [{ id: "qwen", loaded: true }] } satisfies Heartbeat);
      return Promise.resolve();
    });
    const request = vi.fn(() => {
      return Promise.resolve(sse({ reasoning_content: "hm" }, { reasoning_content: "m" }, { content: "he" }, { content: "llo" }));
    });
    const { seen, hooks } = record();
    const reply = await createCompleter({ registry, relay: { request, callClaude: vi.fn() }, loader: { ensure } })("qwen", messages, [], signal, hooks);

    expect(reply.content).toBe("hello");
    expect(seen).toEqual(["routing:qwen", "loading:qwen", "waiting:qwen on pc", "thinking", "writing"]);
  });

  it("skip loading for a model that is already loaded, and report each of thinking and writing once", async () => {
    const registry = new Registry();
    registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }] } satisfies Heartbeat);
    const request = vi.fn(() => {
      return Promise.resolve(sse({ content: "a" }, { content: "b" }));
    });
    const { seen, hooks } = record();
    await createCompleter({ registry, relay: { request, callClaude: vi.fn() }, loader: { ensure: vi.fn() } })("qwen", messages, [], signal, hooks);
    expect(seen).toEqual(["routing:qwen", "waiting:qwen on pc", "writing"]);
  });

  it("report Claude as waiting and then writing", async () => {
    const registry = new Registry();
    registry.upsert({ nodeId: "mac", kind: "local", busy: false, models: [], claude: true } satisfies Heartbeat);
    const callClaude = vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify({ text: "ok" }) });
    });
    const { seen, hooks } = record();
    await createCompleter({ registry, relay: { request: vi.fn(), callClaude }, loader: { ensure: vi.fn() } })("claude", messages, [], signal, hooks);
    expect(seen).toEqual(["waiting:Claude", "writing"]);
  });

  it("fail at once with the reason when no device can serve the model", async () => {
    const registry = new Registry();
    const { seen, hooks } = record();
    const started = Date.now();
    await expect(createCompleter({ registry, relay: { request: vi.fn(), callClaude: vi.fn() }, loader: { ensure: vi.fn() } })("qwen", messages, [], signal, hooks)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen).toEqual(["routing:qwen"]);
  });
});
