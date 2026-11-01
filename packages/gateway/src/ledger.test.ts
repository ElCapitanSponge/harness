import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatMessage, Heartbeat } from "@harness/core";
import type { CallUsage } from "@harness/tools";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { estimateTokens, sqliteLedger, type UsageRecord } from "./ledger.js";
import { Registry } from "./registry.js";
import { Sessions, createCompleter, type Complete } from "./sessions.js";
import { openDatabase } from "./sqlite.js";

const DAY = 86_400_000;
// 2026-11-10 12:00 UTC.
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

const call = (over: Partial<UsageRecord> = {}): UsageRecord => {
  return { time: NOW, conversationId: "c1", device: "pc", model: "qwen", promptTokens: 100, completionTokens: 20, durationMs: 500, estimated: false, ...over };
};

describe("the usage ledger", () => {
  it("totals calls over a number of days, per model and per device", () => {
    const ledger = sqliteLedger(openDatabase(":memory:"));
    ledger.record(call());
    ledger.record(call({ time: NOW - 2 * DAY, promptTokens: 50, completionTokens: 10 }));
    ledger.record(call({ time: NOW - 10 * DAY, promptTokens: 999, completionTokens: 1 }));
    ledger.record(call({ device: "mac", model: "claude", promptTokens: 30, completionTokens: 5, estimated: true }));

    const today = ledger.summary(1, NOW);
    expect(today).toMatchObject({ calls: 2, promptTokens: 130, completionTokens: 25 });
    expect(today.byModel.map((m) => {
      return `${m.model}/${m.device}`;
    })).toEqual(["qwen/pc", "claude/mac"]);
    expect(today.byModel[1]?.estimated).toBe(true);
    expect(today.byModel[0]?.estimated).toBe(false);
    expect(today.byDevice).toMatchObject([{ device: "pc", calls: 1 }, { device: "mac", calls: 1 }]);

    expect(ledger.summary(7, NOW)).toMatchObject({ calls: 3, promptTokens: 180 });
    expect(ledger.summary(30, NOW)).toMatchObject({ calls: 4, promptTokens: 1179 });
  });

  it("counts days from the caller midnight, so a late evening call locally is still that day", () => {
    const ledger = sqliteLedger(openDatabase(":memory:"));
    // 04:00 UTC on 10 Nov is 14:00 on 10 Nov in UTC+10: today there.
    ledger.record(call({ time: Date.UTC(2026, 10, 10, 4, 0, 0) }));
    // 13:00 UTC on 9 Nov is 23:00 on 9 Nov in UTC+10: yesterday there.
    ledger.record(call({ time: Date.UTC(2026, 10, 9, 13, 0, 0) }));
    const aest = ledger.summary(1, NOW, 600);
    expect(aest.calls).toBe(1);
    expect(aest.byDay).toEqual([{ day: "2026-11-10", model: "qwen", tokens: 120 }]);
    expect(ledger.summary(2, NOW, 600).byDay.map((d) => {
      return d.day;
    })).toEqual(["2026-11-09", "2026-11-10"]);
  });

  it("reports a conversation's models and how full its context was after the latest call", () => {
    const ledger = sqliteLedger(openDatabase(":memory:"));
    ledger.record(call({ promptTokens: 1000, completionTokens: 100, contextLength: 32_768 }));
    ledger.record(call({ model: "claude", device: "mac", promptTokens: 1500, completionTokens: 200, contextLength: 200_000, estimated: true }));
    ledger.record(call({ conversationId: "other" }));
    const usage = ledger.forConversation("c1");
    expect(usage.last).toEqual({ model: "claude", device: "mac", promptTokens: 1500, completionTokens: 200, contextLength: 200_000, estimated: true });
    expect(usage.byModel).toHaveLength(2);
    expect(ledger.forConversation("none")).toEqual({ last: undefined, byModel: [] });
  });

  it("survives a restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-ledger-"));
    try {
      const file = path.join(dir, "harness.db");
      const first = openDatabase(file);
      sqliteLedger(first).record(call());
      first.close();
      const second = openDatabase(file);
      expect(sqliteLedger(second).summary(1, NOW).calls).toBe(1);
      second.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("estimates about four characters to a token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

const messages: ChatMessage[] = [{ role: "user", content: "hello there" }];
const signal = new AbortController().signal;
const node = (contextLength?: number): Heartbeat => {
  return { nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true, contextLength }] };
};
const sse = (...chunks: object[]): Response => {
  return new Response(chunks.map((c) => {
    return `data: ${JSON.stringify(c)}\n\n`;
  }).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
};

describe("usage reported by a model call", () => {
  it("uses the server's own counts and the model's context window", async () => {
    const registry = new Registry();
    registry.upsert(node(32_768));
    const request = vi.fn(() => {
      return Promise.resolve(sse({ choices: [{ delta: { content: "hi" } }] }, { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } }));
    });
    const seen: CallUsage[] = [];
    await createCompleter({ registry, relay: { request, callClaude: vi.fn() }, loader: { ensure: vi.fn() } })("qwen", messages, [], signal, {
      usage: (u) => {
        seen.push(u);
      },
    });
    expect(seen).toMatchObject([{ model: "qwen", device: "pc", promptTokens: 42, completionTokens: 7, contextLength: 32_768, estimated: false }]);
    // The request asks for the counts.
    expect(JSON.parse((request.mock.calls[0] as unknown as [string, string])[1])).toMatchObject({ stream_options: { include_usage: true } });
  });

  it("estimates, and says so, when the server reports none", async () => {
    const registry = new Registry();
    registry.upsert(node());
    const request = vi.fn(() => {
      return Promise.resolve(sse({ choices: [{ delta: { content: "hi" } }] }));
    });
    const seen: CallUsage[] = [];
    await createCompleter({ registry, relay: { request, callClaude: vi.fn() }, loader: { ensure: vi.fn() } })("qwen", messages, [], signal, {
      usage: (u) => {
        seen.push(u);
      },
    });
    expect(seen[0]?.estimated).toBe(true);
    expect(seen[0]?.promptTokens).toBeGreaterThan(0);
  });

  it("estimates Claude against a 200k window", async () => {
    const registry = new Registry();
    registry.upsert({ nodeId: "mac", kind: "local", busy: false, models: [], claude: true });
    const callClaude = vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify({ text: "ok" }) });
    });
    const seen: CallUsage[] = [];
    await createCompleter({ registry, relay: { request: vi.fn(), callClaude }, loader: { ensure: vi.fn() } })("claude", messages, [], signal, {
      usage: (u) => {
        seen.push(u);
      },
    });
    expect(seen).toMatchObject([{ model: "claude", device: "mac", contextLength: 200_000, estimated: true }]);
  });
});

describe("the usage routes and a conversation that records its calls", () => {
  it("record each turn and serve the totals and the conversation context", async () => {
    const registry = new Registry();
    const ledger = sqliteLedger(openDatabase(":memory:"));
    const complete = vi.fn<Complete>((_model, _messages, _tools, _signal, hooks) => {
      hooks?.usage?.({ model: "qwen", device: "pc", promptTokens: 10, completionTokens: 5, durationMs: 1, contextLength: 1000, estimated: false });
      return Promise.resolve({ role: "assistant", content: "ok" });
    });
    const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete, ledger });
    const app = createApp({
      registry,
      relay: { request: vi.fn(), callTool: vi.fn(), callClaude: vi.fn(), callModel: vi.fn(), callSettings: vi.fn() },
      loader: { ensure: vi.fn() },
      sessions,
      ledger,
    });
    const chat = sessions.create({ model: "qwen" });
    chat.send("hi");
    for (let i = 0; i < 200 && chat.busy; i++) {
      await new Promise((r) => {
        return setTimeout(r, 5);
      });
    }

    const mine = (await (await app.request(`/sessions/${chat.id}/usage`)).json()) as { last: { contextLength: number; promptTokens: number } };
    expect(mine.last).toMatchObject({ contextLength: 1000, promptTokens: 10 });
    const all = (await (await app.request("/usage?days=1")).json()) as { calls: number; byModel: unknown[] };
    expect(all.calls).toBe(1);
    expect(all.byModel).toHaveLength(1);
    expect((await app.request("/sessions/nope/usage")).status).toBe(404);
    // A junk or out-of-range `days` is clamped, not trusted.
    expect(((await (await app.request("/usage?days=abc")).json()) as { days: number }).days).toBe(7);
    expect(((await (await app.request("/usage?days=99999")).json()) as { days: number }).days).toBe(366);
  });
});
