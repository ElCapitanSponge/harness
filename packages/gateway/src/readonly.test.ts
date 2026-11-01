import type { ChatMessage, Heartbeat, Tool } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import { Sessions, type Complete } from "./sessions.js";

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const setup = () => {
  const registry = new Registry();
  registry.upsert({
    nodeId: "pc",
    kind: "local",
    busy: false,
    models: [],
    roots: ["notes", "proj"],
    readOnlyRoots: ["notes"],
    allowedTools: ["read_file", "write_file", "edit_file", "run_command", "git_read", "git_write"],
  } satisfies Heartbeat);
  const seen: { tools: string[]; system: string }[] = [];
  const complete = vi.fn<Complete>((_model, messages: ChatMessage[], tools: Tool[]) => {
    seen.push({ tools: tools.map((t) => {
      return t.function.name;
    }), system: typeof messages[0]?.content === "string" ? messages[0].content : "" });
    return Promise.resolve({ role: "assistant", content: "ok" });
  });
  return { sessions: new Sessions({ registry, relay: { callTool: vi.fn() }, complete }), seen };
};

describe("a coding session in a folder that can only be read", () => {
  it("is not offered a tool that could change anything, and is told the folder is read-only", async () => {
    const { sessions, seen } = setup();
    const session = sessions.create({ model: "qwen", device: "pc", root: "notes" });
    session.send("look around");
    await until(() => {
      return !session.busy;
    });
    expect(seen[0]?.tools.sort()).toEqual(["git_read", "read_file"]);
    expect(seen[0]?.system).toContain("This folder is read-only");
  });

  it("is offered every allowed tool in a folder that can be changed, on the same device", async () => {
    const { sessions, seen } = setup();
    const session = sessions.create({ model: "qwen", device: "pc", root: "proj" });
    session.send("fix it");
    await until(() => {
      return !session.busy;
    });
    expect(seen[0]?.tools.sort()).toEqual(["edit_file", "git_read", "git_write", "read_file", "run_command", "write_file"]);
    expect(seen[0]?.system).not.toContain("read-only");
  });
});
