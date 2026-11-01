import type { ChatMessage, Heartbeat, ToolCall } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import { Sessions, type Complete, type Session, type SessionEvent } from "./sessions.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  nodeId: "pc",
  kind: "local",
  busy: false,
  models: [{ id: "qwen", loaded: true }],
  roots: ["proj"],
  allowedTools: ["read_file", "list_dir", "grep"],
  platform: "win32",
  ...over,
});

const call = (id: string, name: string, args: unknown): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

let registry: Registry;
let relay: { callTool: ReturnType<typeof vi.fn> };
let complete: ReturnType<typeof vi.fn>;
// The loop reuses one history array, so keep a copy of what the model saw at each call.
let seen: ChatMessage[][];
let sessions: Sessions;

const script = (...replies: ChatMessage[]) => {
  const queue = [...replies];
  complete.mockImplementation(async () => queue.shift() ?? { role: "assistant", content: "done" });
};

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};

const create = (over: Partial<{ model: string; device: string; root: string }> = {}): Session =>
  sessions.create({ model: "qwen", device: "pc", root: "proj", ...over });

const types = (s: Session): string[] => s.events.map((e) => e.type);

beforeEach(() => {
  registry = new Registry();
  registry.upsert(beat());
  relay = { callTool: vi.fn(async () => ({ ok: true, output: "1\tcontents" })) };
  complete = vi.fn();
  seen = [];
  const spy = ((model: string, messages: ChatMessage[], tools: unknown, signal: AbortSignal) => {
    seen.push([...messages]);
    return (complete as unknown as (...a: unknown[]) => Promise<ChatMessage>)(model, messages, tools, signal);
  }) as unknown as Complete;
  sessions = new Sessions({ registry, relay: relay as never, complete: spy });
});

describe("Sessions.create", () => {
  it("creates a session on a connected device with an exposed root", () => {
    const s = create();
    expect(sessions.get(s.id)).toBe(s);
    expect(sessions.list()).toEqual([
      { id: s.id, model: "qwen", device: "pc", root: "proj", busy: false, events: 0, created: expect.any(Number), deviceConnected: true },
    ]);
  });

  it("refuses Claude models, which cannot take client-side tools through the gateway", () => {
    expect(() => create({ model: "claude:sonnet" })).toThrow("Claude models");
  });

  it("refuses a device that is not connected, a root it does not expose, or one with no tools", () => {
    expect(() => create({ device: "ghost" })).toThrow("not connected");
    expect(() => create({ root: "other" })).toThrow('does not expose a project root named "other"');
    registry.upsert(beat({ allowedTools: [] }));
    expect(() => create()).toThrow("does not allow any tools");
  });
});

describe("Session turns", () => {
  it("runs the model loop, runs tool calls on the device, and records the events", async () => {
    script(
      { role: "assistant", content: null, tool_calls: [call("1", "read_file", { path: "a.txt" })] },
      { role: "assistant", content: "It says contents." },
    );
    const s = create();
    s.send("what is in a.txt?");
    await until(() => types(s).includes("done"));

    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_file", { path: "a.txt" }, { session: expect.any(String) });
    expect(s.events).toEqual<SessionEvent[]>([
      { type: "user", text: "what is in a.txt?" },
      { type: "tool", summary: "read a.txt" },
      { type: "text", text: "It says contents." },
      { type: "done", stopped: false },
    ]);
    expect(s.busy).toBe(false);
  });

  it("offers the model only the tools the device allows", async () => {
    script({ role: "assistant", content: "hi" });
    const s = create();
    s.send("hello");
    await until(() => types(s).includes("done"));
    const offered = (complete.mock.calls[0]![2] as { function: { name: string } }[]).map((t) => t.function.name).sort();
    expect(offered).toEqual(["grep", "list_dir", "read_file"]);
  });

  it("puts the project root and device platform in the system prompt", async () => {
    script({ role: "assistant", content: "hi" });
    const s = create();
    s.send("hello");
    await until(() => types(s).includes("done"));
    const messages = seen[0]!;
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(messages[0])).toContain("proj");
    expect(JSON.stringify(messages[0])).toContain("win32");
  });

  it("feeds a failed tool back to the model as an error instead of ending the turn", async () => {
    relay.callTool.mockResolvedValue({ ok: false, output: "file not found" });
    script(
      { role: "assistant", content: null, tool_calls: [call("1", "read_file", { path: "nope" })] },
      { role: "assistant", content: "That file does not exist." },
    );
    const s = create();
    s.send("read nope");
    await until(() => types(s).includes("done"));
    const second = seen[1]!;
    expect(second.at(-1)).toMatchObject({ role: "tool", content: "error: file not found" });
  });

  it("refuses a second message while a turn is running", async () => {
    let release!: (m: ChatMessage) => void;
    complete.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const s = create();
    s.send("first");
    expect(s.busy).toBe(true);
    expect(() => s.send("second")).toThrow("busy");
    release({ role: "assistant", content: "ok" });
    await until(() => !s.busy);
    s.send("third");
  });

  it("keeps the conversation across turns", async () => {
    script({ role: "assistant", content: "one" }, { role: "assistant", content: "two" });
    const s = create();
    s.send("a");
    await until(() => !s.busy);
    s.send("b");
    await until(() => types(s).filter((t) => t === "done").length === 2);
    const second = seen[1]!;
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("reports a model failure and rolls the half-finished turn back so the next one works", async () => {
    complete.mockRejectedValueOnce(new Error("model crashed"));
    const s = create();
    s.send("first");
    await until(() => types(s).includes("error"));
    expect(s.events.at(-1)).toEqual({ type: "error", message: "model crashed" });

    script({ role: "assistant", content: "recovered" });
    s.send("second");
    await until(() => types(s).includes("done"));
    const messages = seen[1]!;
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("cancels a running turn", async () => {
    complete.mockImplementation((_m, _msgs, _t, signal: AbortSignal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("cancelled")))));
    const s = create();
    s.send("go");
    s.cancel();
    await until(() => types(s).includes("cancelled"));
    expect(s.busy).toBe(false);
  });

  it("stops at the step limit if the model keeps calling tools", async () => {
    complete.mockImplementation(async () => ({ role: "assistant", content: null, tool_calls: [call(String(Math.random()), "list_dir", {})] }) as ChatMessage);
    const s = create();
    s.send("loop");
    await until(() => types(s).includes("done"));
    expect(s.events.at(-1)).toEqual({ type: "done", stopped: true });
  });
});

describe("Session.subscribe", () => {
  it("replays past events from an index, then follows live ones, until unsubscribed", async () => {
    script({ role: "assistant", content: "one" }, { role: "assistant", content: "two" });
    const s = create();
    s.send("a");
    await until(() => !s.busy);

    const seen: string[] = [];
    const stop = s.subscribe((e) => seen.push(e.type), 1);
    expect(seen).toEqual(["text", "done"]);

    s.send("b");
    await until(() => seen.includes("done") && seen.length === 5);
    stop();
    s.send("c");
    await until(() => !s.busy);
    expect(seen).toHaveLength(5);
  });
});

describe("Session approvals", () => {
  const writeCall = call("w1", "write_file", { path: "n.txt", content: "x" });
  const writer = (): Session => {
    registry.upsert(beat({ allowedTools: ["read_file", "write_file", "edit_file", "run_command"] }));
    return create();
  };
  const pending = (s: Session) => s.events.find((e) => e.type === "approval") as Extract<SessionEvent, { type: "approval" }> | undefined;

  it("pauses a change until it is approved, then runs it on the device", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "Written." });
    const s = writer();
    s.send("write n.txt");
    await until(() => pending(s) !== undefined);
    expect(relay.callTool).not.toHaveBeenCalled();
    expect(pending(s)).toMatchObject({ tool: "write_file", summary: "write n.txt (1 characters)" });

    expect(s.answer(pending(s)!.id, true)).toBe(true);
    await until(() => types(s).includes("done"));
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "write_file", { path: "n.txt", content: "x" }, { session: expect.any(String) });
    expect(s.events.find((e) => e.type === "approval-resolved")).toMatchObject({ approved: true });
  });

  it("ends the turn without running the change when it is declined", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "should not happen" });
    const s = writer();
    s.send("write n.txt");
    await until(() => pending(s) !== undefined);
    s.answer(pending(s)!.id, false);
    await until(() => types(s).includes("done"));
    expect(relay.callTool).not.toHaveBeenCalled();
    expect(s.events.at(-1)).toEqual({ type: "done", stopped: false, declined: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("remembers an 'always allow' for that tool for the rest of the session", async () => {
    script(
      { role: "assistant", content: null, tool_calls: [writeCall] },
      { role: "assistant", content: "one" },
      { role: "assistant", content: null, tool_calls: [call("w2", "write_file", { path: "m.txt", content: "y" })] },
      { role: "assistant", content: "two" },
    );
    const s = writer();
    s.send("first");
    await until(() => pending(s) !== undefined);
    s.answer(pending(s)!.id, true, true);
    await until(() => !s.busy);

    s.send("second");
    await until(() => !s.busy);
    expect(s.events.filter((e) => e.type === "approval")).toHaveLength(1);
    expect(relay.callTool).toHaveBeenCalledTimes(2);
  });

  it("does not ask at all for a session started with auto-approve", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "Written." });
    registry.upsert(beat({ allowedTools: ["write_file"] }));
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj", autoApprove: true });
    s.send("write n.txt");
    await until(() => types(s).includes("done"));
    expect(types(s)).not.toContain("approval");
    expect(relay.callTool).toHaveBeenCalledTimes(1);
  });

  it("treats a cancel as a decline", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] });
    const s = writer();
    s.send("write n.txt");
    await until(() => pending(s) !== undefined);
    s.cancel();
    await until(() => !s.busy);
    expect(relay.callTool).not.toHaveBeenCalled();
  });

  it("declines after the timeout", async () => {
    vi.useFakeTimers();
    try {
      script({ role: "assistant", content: null, tool_calls: [writeCall] });
      const s = writer();
      s.send("write n.txt");
      await vi.advanceTimersByTimeAsync(10);
      expect(pending(s)).toBeDefined();
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
      expect(s.events.find((e) => e.type === "approval-resolved")).toMatchObject({ approved: false });
      expect(relay.callTool).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers false for an approval that does not exist or was already answered", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] });
    const s = writer();
    s.send("write n.txt");
    await until(() => pending(s) !== undefined);
    const id = pending(s)!.id;
    expect(s.answer("nope", true)).toBe(false);
    expect(s.answer(id, false)).toBe(true);
    expect(s.answer(id, true)).toBe(false);
  });
});
