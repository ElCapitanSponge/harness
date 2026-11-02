import { textOf, type ChatMessage, type Heartbeat, type ToolCall } from "@harness/core";
import type { ProjectContext } from "@harness/tools";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { historyTokens } from "./compaction.js";
import { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { Sessions, type Complete, type Session, type SessionEvent } from "./sessions.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => {
  return {
    nodeId: "pc",
    kind: "local",
    busy: false,
    models: [{ id: "qwen", loaded: true }],
    roots: ["proj"],
    allowedTools: ["read_file", "list_dir", "grep"],
    platform: "win32",
    ...over,
  };
};

const call = (id: string, name: string, args: unknown): ToolCall => {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
};

let registry: Registry;
let relay: { callTool: Mock<Relay["callTool"]> };
let complete: Mock<Complete>;
// The loop reuses one history array, so keep a copy of what the model saw at each call.
let seen: ChatMessage[][];
let sessions: Sessions;

const script = (...replies: ChatMessage[]) => {
  const queue = [...replies];
  complete.mockImplementation(async () => {
    return queue.shift() ?? { role: "assistant", content: "done" };
  });
};

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const create = (over: Partial<{ model: string; device: string; root: string }> = {}): Session => {
  return sessions.create({ model: "qwen", device: "pc", root: "proj", ...over });
};

const types = (s: Session): string[] => {
  return s.events.map((e) => {
    return e.type;
  });
};

beforeEach(() => {
  registry = new Registry();
  registry.upsert(beat());
  relay = { callTool: vi.fn<Relay["callTool"]>(async () => {
    return { ok: true, output: "1\tcontents" };
  }) };
  complete = vi.fn<Complete>();
  seen = [];
  const spy: Complete = (model, messages, tools, signal, hooks) => {
    seen.push([...messages]);
    return complete(model, messages, tools, signal, hooks);
  };
  sessions = new Sessions({ registry, relay: relay, complete: spy });
});

describe("Sessions.create", () => {
  it("creates a session on a connected device with an exposed root", () => {
    const s = create();
    expect(sessions.get(s.id)).toBe(s);
    expect(sessions.list()).toEqual([
      { id: s.id, model: "qwen", device: "pc", root: "proj", busy: false, events: 0, created: expect.any(Number) as number, updated: expect.any(Number) as number, kind: "code", title: "", deviceConnected: true },
    ]);
  });

  it("accepts Claude models, which drive the tool loop through requests in the prompt", () => {
    expect(() => {
      return create({ model: "claude:sonnet" });
    }).not.toThrow();
  });

  it("refuses a device that is not connected, a root it does not expose, or one with no tools", () => {
    expect(() => {
      return create({ device: "ghost" });
    }).toThrow("not connected");
    expect(() => {
      return create({ root: "other" });
    }).toThrow("does not expose a project root named \"other\"");
    registry.upsert(beat({ allowedTools: [] }));
    expect(() => {
      return create();
    }).toThrow("does not allow any tools");
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
    await until(() => {
      return types(s).includes("done");
    });

    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_file", { path: "a.txt" }, { session: expect.any(String) as string });
    expect(s.events).toEqual<SessionEvent[]>([
      { type: "user", text: "what is in a.txt?" },
      { type: "tool", summary: "read a.txt" },
      { type: "text", text: "It says contents.", model: "qwen" },
      { type: "done", stopped: false },
    ]);
    expect(s.busy).toBe(false);
  });

  it("offers the model only the tools the device allows", async () => {
    script({ role: "assistant", content: "hi" });
    const s = create();
    s.send("hello");
    await until(() => {
      return types(s).includes("done");
    });
    const offered = (complete.mock.calls[0]![2] as { function: { name: string } }[]).map((t) => {
      return t.function.name;
    }).sort();
    expect(offered).toEqual(["ask", "grep", "list_dir", "plan", "read_file"]);
  });

  it("puts the project root and device platform in the system prompt", async () => {
    script({ role: "assistant", content: "hi" });
    const s = create();
    s.send("hello");
    await until(() => {
      return types(s).includes("done");
    });
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
    await until(() => {
      return types(s).includes("done");
    });
    const second = seen[1]!;
    expect(second.at(-1)).toMatchObject({ role: "tool", content: "error: file not found" });
  });

  it("refuses a second message while a turn is running", async () => {
    let release!: (m: ChatMessage) => void;
    complete.mockImplementation(() => {
      return new Promise((resolve) => {
        return (release = resolve);
      });
    });
    const s = create();
    s.send("first");
    expect(s.busy).toBe(true);
    expect(() => {
      s.send("second");
    }).toThrow("busy");
    release({ role: "assistant", content: "ok" });
    await until(() => {
      return !s.busy;
    });
    s.send("third");
  });

  it("keeps the conversation across turns", async () => {
    script({ role: "assistant", content: "one" }, { role: "assistant", content: "two" });
    const s = create();
    s.send("a");
    await until(() => {
      return !s.busy;
    });
    s.send("b");
    await until(() => {
      return types(s).filter((t) => {
        return t === "done";
      }).length === 2;
    });
    const second = seen[1]!;
    expect(second.map((m) => {
      return m.role;
    })).toEqual(["system", "user", "assistant", "user"]);
  });

  it("reports a model failure and rolls the half-finished turn back so the next one works", async () => {
    complete.mockRejectedValueOnce(new Error("model crashed"));
    const s = create();
    s.send("first");
    await until(() => {
      return types(s).includes("error");
    });
    expect(s.events.at(-1)).toEqual({ type: "error", message: "model crashed" });

    script({ role: "assistant", content: "recovered" });
    s.send("second");
    await until(() => {
      return types(s).includes("done");
    });
    const messages = seen[1]!;
    expect(messages.map((m) => {
      return m.role;
    })).toEqual(["system", "user"]);
  });

  it("cancels a running turn", async () => {
    complete.mockImplementation((_m, _msgs, _t, signal: AbortSignal) => {
      return new Promise((_res, rej) => {
        signal.addEventListener("abort", () => {
          rej(new Error("cancelled"));
        });
      });
    });
    const s = create();
    s.send("go");
    s.cancel();
    await until(() => {
      return types(s).includes("cancelled");
    });
    expect(s.busy).toBe(false);
  });

  it("stops the turn when it is cancelled while a tool is running, instead of asking the model again", async () => {
    let finishTool!: () => void;
    relay.callTool.mockImplementation(() => {
      return new Promise((resolve) => {
        return (finishTool = () => {
          resolve({ ok: true, output: "x" });
        });
      });
    });
    script({ role: "assistant", content: null, tool_calls: [call("1", "read_file", { path: "a.txt" })] }, { role: "assistant", content: "should not be asked" });
    const s = create();
    s.send("go");
    await until(() => {
      return relay.callTool.mock.calls.length === 1;
    });
    s.cancel();
    finishTool();
    await until(() => {
      return types(s).includes("cancelled");
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(s.busy).toBe(false);
  });

  it("stops at the step limit if the model keeps calling tools", async () => {
    complete.mockImplementation(async () => {
      return { role: "assistant", content: null, tool_calls: [call(String(Math.random()), "list_dir", {})] };
    });
    const s = create();
    s.send("loop");
    await until(() => {
      return types(s).includes("done");
    });
    expect(s.events.at(-1)).toEqual({ type: "done", stopped: true });
  });
});

describe("Session.subscribe", () => {
  it("replays past events from an index, then follows live ones, until unsubscribed", async () => {
    script({ role: "assistant", content: "one" }, { role: "assistant", content: "two" });
    const s = create();
    s.send("a");
    await until(() => {
      return !s.busy;
    });

    const seen: string[] = [];
    const stop = s.subscribe((e) => {
      return seen.push(e.type);
    }, 1);
    expect(seen).toEqual(["text", "done"]);

    s.send("b");
    await until(() => {
      return seen.includes("done") && seen.length === 5;
    });
    stop();
    s.send("c");
    await until(() => {
      return !s.busy;
    });
    expect(seen).toHaveLength(5);
  });
});

describe("Session approvals", () => {
  const writeCall = call("w1", "write_file", { path: "n.txt", content: "x" });
  const writer = (): Session => {
    registry.upsert(beat({ allowedTools: ["read_file", "write_file", "edit_file", "run_command"] }));
    return create();
  };
  const pending = (s: Session) => {
    return s.events.find((e): e is Extract<SessionEvent, { type: "approval" }> => {
      return e.type === "approval";
    });
  };

  it("pauses a change until it is approved, then runs it on the device", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "Written." });
    const s = writer();
    s.send("write n.txt");
    await until(() => {
      return pending(s) !== undefined;
    });
    expect(relay.callTool).not.toHaveBeenCalled();
    expect(pending(s)).toMatchObject({ tool: "write_file", summary: "write n.txt (1 characters)" });

    expect(s.answer(pending(s)!.id, true)).toBe(true);
    await until(() => {
      return types(s).includes("done");
    });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "write_file", { path: "n.txt", content: "x" }, { session: expect.any(String) as string });
    expect(s.events.find((e) => {
      return e.type === "approval-resolved";
    })).toMatchObject({ approved: true });
  });

  it("ends the turn without running the change when it is declined", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "should not happen" });
    const s = writer();
    s.send("write n.txt");
    await until(() => {
      return pending(s) !== undefined;
    });
    s.answer(pending(s)!.id, false);
    await until(() => {
      return types(s).includes("done");
    });
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
    await until(() => {
      return pending(s) !== undefined;
    });
    s.answer(pending(s)!.id, true, true);
    await until(() => {
      return !s.busy;
    });

    s.send("second");
    await until(() => {
      return !s.busy;
    });
    expect(s.events.filter((e) => {
      return e.type === "approval";
    })).toHaveLength(1);
    expect(relay.callTool).toHaveBeenCalledTimes(2);
  });

  it("does not ask at all for a session started with auto-approve", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] }, { role: "assistant", content: "Written." });
    registry.upsert(beat({ allowedTools: ["write_file"] }));
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj", autoApprove: true });
    s.send("write n.txt");
    await until(() => {
      return types(s).includes("done");
    });
    expect(types(s)).not.toContain("approval");
    expect(relay.callTool).toHaveBeenCalledTimes(1);
  });

  it("treats a cancel as a decline", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] });
    const s = writer();
    s.send("write n.txt");
    await until(() => {
      return pending(s) !== undefined;
    });
    s.cancel();
    await until(() => {
      return !s.busy;
    });
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
      expect(s.events.find((e) => {
        return e.type === "approval-resolved";
      })).toMatchObject({ approved: false });
      expect(relay.callTool).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers false for an approval that does not exist or was already answered", async () => {
    script({ role: "assistant", content: null, tool_calls: [writeCall] });
    const s = writer();
    s.send("write n.txt");
    await until(() => {
      return pending(s) !== undefined;
    });
    const id = pending(s)!.id;
    expect(s.answer("nope", true)).toBe(false);
    expect(s.answer(id, false)).toBe(true);
    expect(s.answer(id, true)).toBe(false);
  });
});

describe("Session in Auto mode", () => {
  const auto = (): Session => {
    sessions = new Sessions({
      registry,
      relay,
      complete: complete,
      autoPrefs: { prefer: [], avoid: [], keepFree: [] },
    });
    return create({ model: "auto" });
  };

  it("chooses a model for the turn, answers with it, and says why", async () => {
    registry.upsert(beat({ models: [{ id: "qwen", loaded: true, contextLength: 32_768 }] }));
    script({ role: "assistant", content: "hi" });
    const s = auto();
    s.send("hello");
    await until(() => {
      return types(s).includes("done");
    });
    expect(complete.mock.calls[0]?.[0]).toBe("qwen");
    expect(s.model).toBe("auto");
    expect(s.info().chosen).toMatchObject({ model: "qwen", device: "pc" });
    expect(s.events.find((e) => {
      return e.type === "text";
    })).toMatchObject({ model: "qwen", reason: expect.stringContaining("qwen") as string });
  });

  it("ends the turn with the reason, and keeps nothing, when no model can be used", async () => {
    registry.upsert(beat({ busy: true, busyReason: "a game" }));
    const s = auto();
    s.send("hello");
    await until(() => {
      return types(s).includes("error");
    });
    expect(complete).not.toHaveBeenCalled();
    expect(s.events.find((e) => {
      return e.type === "error";
    })).toMatchObject({ message: expect.stringContaining("every device is busy") as string });
    expect(s.busy).toBe(false);
  });
});

describe("Session and the project's skills", () => {
  const withContext = (context: ProjectContext | undefined): Session => {
    sessions = new Sessions({ registry, relay, complete, projectContext: async () => {
      return context;
    } });
    registry.upsert(beat({ allowedTools: ["read_file", "skill"] }));
    return create();
  };
  const toolNames = (): string[] => {
    return (complete.mock.calls[0]?.[2] ?? []).map((t) => {
      return t.function.name;
    });
  };

  it("tells the model about the instructions and the skills it may start, and offers the skill tool", async () => {
    script({ role: "assistant", content: "ok" });
    const s = withContext({
      instructions: [{ source: "AGENTS.md", text: "Use pnpm." }],
      skills: [{ name: "tdd", description: "Test first.", length: 100, modelInvocable: true, source: "user" }, { name: "quiet", description: "Hidden.", length: 100, modelInvocable: false, source: "user" }],
      skipped: [],
    });
    s.send("go");
    await until(() => {
      return types(s).includes("done");
    });
    const system = textOf(complete.mock.calls[0]?.[1][0]?.content);
    expect(system).toContain("Use pnpm.");
    expect(system).toContain("- tdd: Test first.");
    expect(system).not.toContain("quiet");
    expect(toolNames()).toContain("skill");

    // A second turn replaces the context instead of adding it again.
    s.send("again");
    await until(() => {
      return complete.mock.calls.length === 2 && !s.busy;
    });
    expect(textOf(complete.mock.calls[1]?.[1][0]?.content).split("Use pnpm.")).toHaveLength(2);
  });

  it("does not offer the skill tool when no skill may be started, or when the device cannot say", async () => {
    script({ role: "assistant", content: "ok" });
    const none = withContext({ instructions: [], skills: [{ name: "quiet", description: "Hidden.", length: 100, modelInvocable: false, source: "user" }], skipped: [] });
    none.send("go");
    await until(() => {
      return types(none).includes("done");
    });
    expect(toolNames()).not.toContain("skill");

    complete.mockClear();
    script({ role: "assistant", content: "ok" });
    const old = withContext(undefined);
    old.send("go");
    await until(() => {
      return types(old).includes("done");
    });
    expect(toolNames()).not.toContain("skill");
  });
});

describe("Session and a skill the person starts", () => {
  const withSkill = (startSkill: (name: string, args: string) => Promise<string>): Session => {
    sessions = new Sessions({ registry, relay, complete, startSkill: async (_d, _r, _s, name, args) => {
      return startSkill(name, args);
    } });
    return create();
  };

  it("puts the skill's instructions in the conversation after what was typed, and records a skill event", async () => {
    let lastMessage = "";
    complete.mockImplementation(async (_model, messages) => {
      lastMessage = textOf(messages.at(-1)?.content);
      return { role: "assistant", content: "ok" };
    });
    const s = withSkill(async (name, args) => {
      return `[${name}] ${args}`;
    });
    s.send("/tdd the parser", undefined, undefined, { name: "tdd", arguments: "the parser" });
    await until(() => {
      return types(s).includes("done");
    });
    expect(types(s)).toEqual(["user", "skill", "text", "done"]);
    expect(s.events[1]).toEqual({ type: "skill", name: "tdd", arguments: "the parser", text: "[tdd] the parser" });
    expect(lastMessage).toContain("/tdd the parser");
    expect(lastMessage).toContain("[tdd] the parser");
  });

  it("ends the turn with the reason, keeping nothing, if the skill cannot be loaded", async () => {
    const s = withSkill(async () => {
      throw new Error("there is no skill named \"nope\"");
    });
    s.send("/nope", undefined, undefined, { name: "nope" });
    await until(() => {
      return types(s).includes("error");
    });
    expect(complete).not.toHaveBeenCalled();
    expect(s.busy).toBe(false);
  });

  it("is refused in a chat, which has no device to load it from", () => {
    sessions = new Sessions({ registry, relay, complete, startSkill: async () => {
      return "x";
    } });
    const chat = sessions.create({ model: "qwen" });
    expect(() => {
      chat.send("/tdd", undefined, undefined, { name: "tdd" });
    }).toThrow("coding session");
  });
});

describe("Session side panel data", () => {
  it("records what a write changed as an event for the person, and never puts the diff in the model's context", async () => {
    registry.upsert(beat({ allowedTools: ["read_file", "write_file"] }));
    relay.callTool.mockResolvedValue({ ok: true, output: "wrote 5 characters to a.txt", change: { path: "a.txt", created: true, added: 1, removed: 0, patch: "@@ -0,0 +1,1 @@\n+hello" } });
    const shown: string[] = [];
    complete.mockImplementation(async (_model, messages) => {
      shown.push(JSON.stringify(messages));
      return shown.length === 1 ? { role: "assistant", content: null, tool_calls: [call("1", "write_file", { path: "a.txt", content: "hello" })] } : { role: "assistant", content: "done" };
    });
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj", autoApprove: true });
    s.send("write a.txt");
    await until(() => {
      return types(s).includes("done");
    });
    expect(types(s)).toEqual(["user", "tool", "change", "text", "done"]);
    expect(s.events[2]).toEqual({ type: "change", change: expect.objectContaining({ path: "a.txt", added: 1 }) as unknown });
    // The model saw the tool's result and nothing of the diff.
    expect(shown[1]).toContain("wrote 5 characters to a.txt");
    expect(shown[1]).not.toContain("@@");
    expect(shown[1]).not.toContain("+hello");
  });

  it("offers the plan tool in a coding session, keeps the plan as an event, and answers the model", async () => {
    const steps = [{ text: "read the code", status: "done" }, { text: "fix it", status: "in_progress" }];
    script({ role: "assistant", content: null, tool_calls: [call("1", "plan", { steps })] }, { role: "assistant", content: "ok" });
    const s = create();
    s.send("do it");
    await until(() => {
      return types(s).includes("done");
    });
    expect(complete.mock.calls[0]?.[2].map((t) => {
      return t.function.name;
    })).toContain("plan");
    expect(s.events.find((e) => {
      return e.type === "plan";
    })).toEqual({ type: "plan", steps });
    // The plan never goes to the device.
    expect(relay.callTool).not.toHaveBeenCalled();
  });

  it("tells the model what is wrong with a plan it got wrong, and keeps going", async () => {
    script({ role: "assistant", content: null, tool_calls: [call("1", "plan", { steps: [] })] }, { role: "assistant", content: "ok" });
    const s = create();
    s.send("do it");
    await until(() => {
      return types(s).includes("done");
    });
    expect(types(s)).not.toContain("plan");
  });

  it("is not offered in a chat", async () => {
    script({ role: "assistant", content: "hi" });
    const chat = sessions.create({ model: "qwen" });
    chat.send("hello");
    await until(() => {
      return types(chat).includes("done");
    });
    expect(complete.mock.calls[0]?.[2]).toEqual([]);
  });
});

describe("Session with images", () => {
  const png = { mediaType: "image/png" as const, data: "iVBORw0KGgo=" };
  const lastUser = (): ChatMessage | undefined => {
    return complete.mock.calls[0]?.[1].find((m) => {
      return m.role === "user";
    });
  };

  it("sends the image to a model that can read it, in the standard message format, and keeps it with the session", async () => {
    registry.upsert(beat({ models: [{ id: "qwen2.5-vl-7b", loaded: true }] }));
    let seenContent: ChatMessage["content"];
    complete.mockImplementation(async (_m, messages) => {
      seenContent = messages.find((m) => {
        return m.role === "user";
      })?.content;
      return { role: "assistant", content: "a cat" };
    });
    const s = sessions.create({ model: "qwen2.5-vl-7b" });
    s.send("what is this?", undefined, undefined, undefined, [png]);
    await until(() => {
      return types(s).includes("done");
    });
    expect(seenContent).toEqual([{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }]);
    expect(s.events[0]).toEqual({ type: "user", text: "what is this?", images: [png] });
    expect(types(s)).not.toContain("notice");
  });

  it("tells the person when the model cannot read images, and sends the text alone", async () => {
    script({ role: "assistant", content: "ok" });
    const s = sessions.create({ model: "qwen" });
    s.send("what is this?", undefined, undefined, undefined, [png]);
    await until(() => {
      return types(s).includes("done");
    });
    expect(types(s)).toEqual(["user", "notice", "text", "done"]);
    expect(s.events[1]).toMatchObject({ type: "notice", text: expect.stringContaining("qwen does not look like a model that can read images") as string });
    expect(lastUser()?.content).toBe("what is this?");
  });

  it("replaces a picture with a note when a later turn goes to a model that cannot read it", async () => {
    registry.upsert(beat({ models: [{ id: "qwen2.5-vl-7b", loaded: true }, { id: "qwen", loaded: true }] }));
    const sent: string[] = [];
    complete.mockImplementation(async (model, messages) => {
      sent.push(`${model}: ${JSON.stringify(messages)}`);
      return { role: "assistant", content: "ok" };
    });
    const s = sessions.create({ model: "qwen2.5-vl-7b" });
    s.send("look", undefined, undefined, undefined, [png]);
    await until(() => {
      return types(s).includes("done");
    });
    s.send("and now?", "qwen");
    await until(() => {
      return types(s).filter((t) => {
        return t === "done";
      }).length === 2;
    });
    expect(sent[0]).toContain("iVBORw0KGgo=");
    expect(sent[1]).not.toContain("iVBORw0KGgo=");
    expect(sent[1]).toContain("[an image was attached here]");
  });

  it("counts a picture as a fixed amount, not as its bytes", () => {
    const big = { role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(4_000_000)}` } }] } as ChatMessage;
    expect(historyTokens([big])).toBeLessThan(1100);
    expect(historyTokens([big])).toBeGreaterThanOrEqual(1000);
  });
});

describe("Session asking the person a question", () => {
  const asks = (args: Record<string, unknown>) => {
    return { role: "assistant" as const, content: null, tool_calls: [call("1", "ask", args)] };
  };
  const pendingQuestion = (s: Session) => {
    return s.events.find((e): e is Extract<SessionEvent, { type: "question" }> => {
      return e.type === "question";
    });
  };

  it("shows the question with its options, waits for the answer, and gives it to the model", async () => {
    let toolReply = "";
    complete.mockImplementationOnce(async () => {
      return asks({ question: "Which database?", options: ["SQLite", "Postgres"] });
    }).mockImplementationOnce(async (_m, messages) => {
      toolReply = textOf(messages.at(-1)?.content);
      return { role: "assistant", content: "ok" };
    });
    const s = create();
    s.subscribe(() => {
      return undefined;
    }, s.events.length);
    s.send("set up storage");
    await until(() => {
      return pendingQuestion(s) !== undefined;
    });
    expect(pendingQuestion(s)).toMatchObject({ question: "Which database?", options: ["SQLite", "Postgres"] });

    expect(s.answerQuestion(pendingQuestion(s)?.id ?? "", "SQLite")).toBe(true);
    await until(() => {
      return types(s).includes("done");
    });
    expect(toolReply).toBe("The person answered: SQLite");
    expect(s.events.find((e) => {
      return e.type === "question-resolved";
    })).toMatchObject({ answer: "SQLite" });
    expect(relay.callTool).not.toHaveBeenCalled();
    expect(s.answerQuestion(pendingQuestion(s)?.id ?? "", "again")).toBe(false);
  });

  it("says nobody answered, without waiting, when no one is watching the conversation", async () => {
    let toolReply = "";
    complete.mockImplementationOnce(async () => {
      return asks({ question: "Which database?" });
    }).mockImplementationOnce(async (_m, messages) => {
      toolReply = textOf(messages.at(-1)?.content);
      return { role: "assistant", content: "I need to know which database." };
    });
    const s = create();
    s.send("set up storage");
    await until(() => {
      return types(s).includes("done");
    });
    expect(toolReply).toContain("Nobody answered. Do not guess");
    expect(types(s)).not.toContain("question");
  });

  it("tells the model what is wrong with a question it got wrong", async () => {
    let toolReply = "";
    complete.mockImplementationOnce(async () => {
      return asks({ question: "", options: "yes" });
    }).mockImplementationOnce(async (_m, messages) => {
      toolReply = textOf(messages.at(-1)?.content);
      return { role: "assistant", content: "ok" };
    });
    const s = create();
    s.send("go");
    await until(() => {
      return types(s).includes("done");
    });
    expect(toolReply).toContain("must be the question to ask");
  });

  it("is not offered in a chat", async () => {
    script({ role: "assistant", content: "hi" });
    const chat = sessions.create({ model: "qwen" });
    chat.send("hello");
    await until(() => {
      return types(chat).includes("done");
    });
    expect(complete.mock.calls[0]?.[2]).toEqual([]);
  });
});

describe("Session question cancelled or unanswered", () => {
  it("counts a cancel as nobody answering, and records that", async () => {
    complete.mockImplementationOnce(async () => {
      return { role: "assistant", content: null, tool_calls: [call("1", "ask", { question: "Sure?" })] };
    });
    const s = create();
    s.subscribe(() => {
      return undefined;
    }, 0);
    s.send("go");
    await until(() => {
      return types(s).includes("question");
    });
    s.cancel();
    await until(() => {
      return !s.busy;
    });
    expect(s.events.find((e) => {
      return e.type === "question-resolved";
    })).toEqual({ type: "question-resolved", id: expect.any(String) as string });
  });
});
