import type { ChatMessage, Heartbeat } from "@harness/core";
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

const systemFor = async (beat: Partial<Heartbeat>): Promise<string> => {
  const registry = new Registry();
  registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [], roots: ["proj"], allowedTools: ["read_file", "run_command"], ...beat } satisfies Heartbeat);
  let system = "";
  const complete = vi.fn<Complete>((_model, messages: ChatMessage[]) => {
    system = typeof messages[0]?.content === "string" ? messages[0].content : "";
    return Promise.resolve({ role: "assistant", content: "ok" });
  });
  const session = new Sessions({ registry, relay: { callTool: vi.fn() }, complete }).create({ model: "qwen", device: "pc", root: "proj" });
  session.send("hi");
  await until(() => {
    return !session.busy;
  });
  return system;
};

describe("telling the model which shell the device has", () => {
  it("names PowerShell, or cmd, as the device reported it", async () => {
    const power = await systemFor({ platform: "win32", shell: "PowerShell" });
    expect(power).toContain("Commands run in PowerShell (pwsh) on Windows");
    const prompt = await systemFor({ platform: "win32", shell: "cmd" });
    expect(prompt).toContain("Commands run in cmd.exe");
    expect(prompt).toContain("PowerShell is not installed");
  });

  it("names zsh on a Mac and bash on Linux, and says to use a command when no tool fits", async () => {
    expect(await systemFor({ platform: "darwin", shell: "zsh" })).toContain("zsh on macOS");
    const linux = await systemFor({ platform: "linux", shell: "bash" });
    expect(linux).toContain("bash on Linux");
    expect(linux).toContain("do it with a command");
  });

  it("assumes the command prompt for an older Windows agent that did not say", async () => {
    expect(await systemFor({ platform: "win32" })).toContain("cmd.exe");
  });
});
