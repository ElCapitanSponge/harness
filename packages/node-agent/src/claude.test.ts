import type { ChatRequest, TunnelMessage } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createClaudeServer } from "./claude.js";

const body = (over: Record<string, unknown> = {}): string => JSON.stringify({ model: "claude:sonnet", messages: [{ role: "user", content: "ping" }], ...over });

async function ask(run: (bin: string, req: ChatRequest) => Promise<{ text: string; model: string }>, raw: string): Promise<TunnelMessage> {
  const out: TunnelMessage[] = [];
  await createClaudeServer({ bin: "claude", run }).handle({ type: "claude", id: "c1", body: raw }, (m) => out.push(m));
  expect(out).toHaveLength(1);
  return out[0]!;
}

describe("createClaudeServer", () => {
  it("runs the claude CLI with the request and returns its answer as JSON", async () => {
    const run = vi.fn(async () => ({ text: "pong", model: "claude-sonnet" }));
    const reply = await ask(run, body());
    expect(reply).toEqual({ type: "tool-result", id: "c1", ok: true, output: JSON.stringify({ text: "pong", model: "claude-sonnet" }) });
    expect(run).toHaveBeenCalledWith("claude", expect.objectContaining({ model: "claude:sonnet" }));
  });

  it("reports the CLI's failure, such as not being logged in", async () => {
    const reply = await ask(async () => {
      throw new Error("Not logged in");
    }, body());
    expect(reply).toEqual({ type: "tool-result", id: "c1", ok: false, output: "Not logged in" });
  });

  it("rejects a malformed request without starting the CLI", async () => {
    const run = vi.fn();
    expect(await ask(run as never, "not json")).toMatchObject({ ok: false });
    expect(await ask(run as never, JSON.stringify({ model: "claude" }))).toMatchObject({ ok: false, output: "invalid chat request" });
    expect(run).not.toHaveBeenCalled();
  });
});
