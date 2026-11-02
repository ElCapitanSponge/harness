import type { ChatMessage, ClaudeLimits, Heartbeat } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { ClaudeState, ClaudeUnavailableError, askClaude } from "./claude.js";
import { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { Sessions } from "./sessions.js";

const NOW = 1_800_000_000_000;
const window = (utilization: number, hoursAway: number) => {
  return { utilization, resetsAt: Math.round((NOW + hoursAway * 3_600_000) / 1000) };
};
const limits = (over: Partial<ClaudeLimits> = {}): ClaudeLimits => {
  return { status: "allowed", fiveHour: window(0.4, 2), sevenDay: window(0.47, 90), usingOverage: false, observedAt: NOW, ...over };
};
const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
const mac: Heartbeat = { nodeId: "mac", kind: "local", busy: false, models: [], claude: true };

describe("what the gateway knows of the Claude plan", () => {
  it("is unreadable until a reply has been seen, and then shows the windows", () => {
    const state = new ClaudeState();
    expect(state.status(NOW)).toMatchObject({ readable: false, available: true });
    state.observe("mac", limits());
    expect(state.status(NOW)).toMatchObject({ readable: true, available: true, device: "mac", fiveHour: { utilization: 0.4 }, sevenDay: { utilization: 0.47 }, usingOverage: false });
  });

  it("remembers the model the program said it used, with its window, and invents none", () => {
    const state = new ClaudeState();
    expect(state.status(NOW).model).toBeUndefined();
    state.observeModel(undefined, undefined);
    expect(state.status(NOW).model).toBeUndefined();
    state.observeModel("claude-sonnet-5-5", 1_000_000);
    expect(state.status(NOW)).toMatchObject({ model: "claude-sonnet-5-5", contextWindow: 1_000_000 });
    // A later reply that names no model leaves what was known; one that names another model replaces it.
    state.observeModel(undefined, undefined);
    expect(state.reportedModel()).toBe("claude-sonnet-5-5");
    state.observeModel("claude-opus-5", undefined);
    expect(state.status(NOW)).toMatchObject({ model: "claude-opus-5" });
    expect(state.contextWindow()).toBeUndefined();
  });

  it("is unavailable until the reset time, then comes back by itself", () => {
    const state = new ClaudeState();
    state.markLimited("mac", limits({ status: "rejected", limitedUntil: NOW + 3_600_000 }));
    expect(state.status(NOW)).toMatchObject({ available: false, limitedUntil: NOW + 3_600_000 });
    expect(state.limitedUntil(NOW + 3_599_999)).toBe(NOW + 3_600_000);
    expect(state.limitedUntil(NOW + 3_600_001)).toBeUndefined();
    expect(state.status(NOW + 3_600_001).available).toBe(true);
  });

  it("ends a refusal when a reply gets through, and ignores a reply with no plan information", () => {
    const state = new ClaudeState();
    state.markLimited("mac", limits({ limitedUntil: NOW + 3_600_000 }));
    state.observe("mac", undefined);
    expect(state.limitedUntil(NOW)).toBe(NOW + 3_600_000);
    state.observe("mac", limits());
    expect(state.limitedUntil(NOW)).toBeUndefined();
  });
});

describe("askClaude", () => {
  const deps = (callClaude: Relay["callClaude"], state = new ClaudeState()) => {
    const registry = new Registry();
    registry.upsert(mac);
    return { registry, relay: { callClaude }, state };
  };

  it("returns the reply and remembers the plan's windows", async () => {
    const callClaude = vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify({ text: "hello", model: "claude", limits: limits() }) });
    });
    const d = deps(callClaude);
    const { result, device } = await askClaude(d, "claude", messages);
    expect(result.text).toBe("hello");
    expect(device).toBe("mac");
    expect(d.state.status().readable).toBe(true);
  });

  it("refuses at once, without asking the device, while Claude is limited", async () => {
    const callClaude = vi.fn<Relay["callClaude"]>();
    const state = new ClaudeState();
    state.markLimited("mac", limits({ limitedUntil: Date.now() + 3_600_000 }));
    await expect(askClaude(deps(callClaude, state), "claude", messages)).rejects.toBeInstanceOf(ClaudeUnavailableError);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("turns the agent's limit refusal into an unavailable window and says when it ends", async () => {
    const until = Date.now() + 2 * 3_600_000;
    const callClaude = vi.fn(() => {
      return Promise.resolve({ ok: false, output: JSON.stringify({ limited: true, message: "5-hour limit reached", limits: limits({ status: "rejected", limitedUntil: until }) }) });
    });
    const d = deps(callClaude);
    const error = await askClaude(d, "claude", messages).catch((e: unknown) => {
      return e;
    });
    expect(error).toBeInstanceOf(ClaudeUnavailableError);
    expect((error as ClaudeUnavailableError).until).toBe(until);
    expect((error as ClaudeUnavailableError).message).toContain("Pick a local model");
    expect(d.state.status().available).toBe(false);
  });

  it("passes any other failure on unchanged, and says so when no device has Claude", async () => {
    const failing = vi.fn(() => {
      return Promise.resolve({ ok: false, output: "model not found" });
    });
    await expect(askClaude(deps(failing), "claude", messages)).rejects.toThrow("model not found");
    await expect(askClaude({ registry: new Registry(), relay: { callClaude: vi.fn() }, state: new ClaudeState() }, "claude", messages)).rejects.toThrow("no connected device is logged in to Claude");
  });
});

describe("the gateway while Claude is limited", () => {
  const build = (state: ClaudeState) => {
    const registry = new Registry();
    registry.upsert(mac);
    registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }] });
    const callClaude = vi.fn<Relay["callClaude"]>();
    const app = createApp({
      registry,
      relay: { request: vi.fn(), callTool: vi.fn(), callClaude, callModel: vi.fn(), callSettings: vi.fn() },
      loader: { ensure: vi.fn() },
      sessions: new Sessions({ registry, relay: { callTool: vi.fn() }, complete: vi.fn() }),
      claude: state,
    });
    return { app, callClaude };
  };
  const limited = (): ClaudeState => {
    const state = new ClaudeState();
    state.markLimited("mac", limits({ status: "rejected", limitedUntil: Date.now() + 3_600_000 }));
    return state;
  };

  it("stops offering Claude models, but keeps the local ones", async () => {
    const { app } = build(limited());
    const models = ((await (await app.request("/v1/models")).json()) as { data: { id: string }[] }).data.map((m) => {
      return m.id;
    });
    expect(models).toEqual(["qwen"]);
    const catalogue = (await (await app.request("/catalogue")).json()) as { claude: { available: boolean; limitedUntil?: number } };
    expect(catalogue.claude.available).toBe(false);
    expect(catalogue.claude.limitedUntil).toBeGreaterThan(Date.now());
  });

  it("answers a Claude request with 429, when to retry, and a pointer to the local models", async () => {
    const { app, callClaude } = build(limited());
    const res = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude", messages }) });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(3000);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("local model");
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("reports the plan's windows, or that they cannot be read yet", async () => {
    expect(((await (await build(new ClaudeState()).app.request("/claude/usage")).json()) as { readable: boolean }).readable).toBe(false);
    const state = new ClaudeState();
    state.observe("mac", limits());
    const usage = (await (await build(state).app.request("/claude/usage")).json()) as { readable: boolean; sevenDay: { utilization: number } };
    expect(usage).toMatchObject({ readable: true, sevenDay: { utilization: 0.47 } });
  });

  it("offers Claude again once the limit has passed", async () => {
    const state = new ClaudeState();
    state.markLimited("mac", limits({ limitedUntil: Date.now() - 1000 }));
    const models = ((await (await build(state).app.request("/v1/models")).json()) as { data: { id: string }[] }).data.map((m) => {
      return m.id;
    });
    expect(models).toContain("claude");
  });
});

describe("carrying on Claude's own conversation across the steps of a session", () => {
  const user = (content: string): ChatMessage => {
    return { role: "user", content };
  };
  const assistant = (content: string): ChatMessage => {
    return { role: "assistant", content };
  };
  // A device that answers like the program: its conversation then holds every turn sent, and its reply.
  const run = () => {
    const sent: { continuation?: { id: string; seen: number }; messages: ChatMessage[] }[] = [];
    const callClaude = vi.fn<Relay["callClaude"]>((_device, body) => {
      const req = JSON.parse(body) as { continuation?: { id: string; seen: number }; messages: ChatMessage[] };
      sent.push(req);
      const turns = req.messages.filter((m) => {
        return m.role !== "system";
      }).length;
      return Promise.resolve({ ok: true, output: JSON.stringify({ text: "ok", model: "claude", ...(req.continuation ? { continuation: { id: req.continuation.id, seen: turns + 1 } } : {}) }) });
    });
    const registry = new Registry();
    registry.upsert(mac);
    return { sent, deps: { registry, relay: { callClaude }, state: new ClaudeState() } };
  };

  it("starts a conversation, then resumes it with the turns it has not seen", async () => {
    const { sent, deps } = run();
    const first = [user("a")];
    await askClaude(deps, "claude", first, { conversation: "c1" });
    expect(sent[0]?.continuation?.seen).toBe(0);
    await askClaude(deps, "claude", [...first, assistant("ok"), user("b")], { conversation: "c1" });
    expect(sent[1]?.continuation).toEqual({ id: sent[0]?.continuation?.id, seen: 2 });
  });

  it("starts again when the earlier turns changed, as after compaction or a rewind", async () => {
    const { sent, deps } = run();
    await askClaude(deps, "claude", [user("a")], { conversation: "c1" });
    await askClaude(deps, "claude", [user("a, edited"), assistant("ok"), user("b")], { conversation: "c1" });
    expect(sent[1]?.continuation?.seen).toBe(0);
    expect(sent[1]?.continuation?.id).not.toBe(sent[0]?.continuation?.id);
  });

  it("starts again for another model, and keeps conversations apart", async () => {
    const { sent, deps } = run();
    await askClaude(deps, "claude:sonnet", [user("a")], { conversation: "c1" });
    await askClaude(deps, "claude:opus", [user("a"), assistant("ok"), user("b")], { conversation: "c1" });
    expect(sent[1]?.continuation?.seen).toBe(0);
    await askClaude(deps, "claude:opus", [user("z")], { conversation: "c2" });
    expect(sent[2]?.continuation?.seen).toBe(0);
  });

  it("sends nothing of the kind without a conversation, or for a caller that supplies its own body", async () => {
    const { sent, deps } = run();
    await askClaude(deps, "claude", [user("a")]);
    expect(sent[0]?.continuation).toBeUndefined();
    await askClaude(deps, "claude", [user("a")], { conversation: "c1", body: JSON.stringify({ model: "claude", messages: [user("a")] }) });
    expect(sent[1]?.continuation).toBeUndefined();
  });

  it("forgets the conversation when a step fails, so the next one starts clean", async () => {
    const { sent, deps } = run();
    await askClaude(deps, "claude", [user("a")], { conversation: "c1" });
    deps.relay.callClaude.mockResolvedValueOnce({ ok: false, output: "boom" });
    await expect(askClaude(deps, "claude", [user("a"), assistant("ok"), user("b")], { conversation: "c1" })).rejects.toThrow("boom");
    await askClaude(deps, "claude", [user("a"), assistant("ok"), user("b")], { conversation: "c1" });
    expect(sent.at(-1)?.continuation?.seen).toBe(0);
  });
});
