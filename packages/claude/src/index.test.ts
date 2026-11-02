import type { ChatRequest } from "@harness/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildArgs, conversationsDir, pruneConversations, runClaude, toOpenAIResponse, toPrompt, toSse } from "./index.js";

describe("toSse", () => {
  const events = (s: string) => {
    return s.split("\n\n").filter(Boolean);
  };

  it("emits a content chunk, a stop chunk and [DONE]", () => {
    const [first, stop, done] = events(toSse({ text: "pong", model: "claude:sonnet" }));
    expect(JSON.parse(first!.replace("data: ", ""))).toMatchObject({
      object: "chat.completion.chunk",
      model: "claude:sonnet",
      choices: [{ delta: { role: "assistant", content: "pong" }, finish_reason: null }],
    });
    expect((JSON.parse(stop!.replace("data: ", "")) as { choices: { finish_reason: string }[] }).choices[0]?.finish_reason).toBe("stop");
    expect(done).toBe("data: [DONE]");
  });
});

describe("toPrompt with rich messages", () => {
  it("reads text parts and shows a tool result by the name of the tool it answers", () => {
    const out = toPrompt({
      model: "claude",
      messages: [
        { role: "system", content: [{ type: "text", text: "be brief" }] },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: null },
        { role: "tool", tool_call_id: "1", content: "ignored" },
        { role: "user", content: "again" },
      ],
    });
    expect(out.system).toBe("be brief");
    expect(out.prompt).toBe("User: hello\n\nAssistant:\n\n<tool_result name=\"tool\">\nignored\n</tool_result>\n\nUser: again");
  });
});

const req = (model: string, messages: ChatRequest["messages"]): ChatRequest => {
  return { model, messages };
};

describe("toPrompt", () => {
  it("uses a single user message verbatim", () => {
    expect(toPrompt(req("claude", [{ role: "user", content: "hello" }]))).toEqual({ system: undefined, prompt: "hello" });
  });

  it("splits system messages out and labels multi-turn history", () => {
    const out = toPrompt(
      req("claude", [
        { role: "system", content: "be brief" },
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ]),
    );
    expect(out.system).toBe("be brief");
    expect(out.prompt).toBe("User: a\n\nAssistant: b\n\nUser: c");
  });
});

describe("buildArgs", () => {
  it("runs headless with no tools or session persistence", () => {
    const args = buildArgs(req("claude", [{ role: "user", content: "x" }]));
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--tools", ""]));
    expect(args).not.toContain("--model");
  });

  it("passes the alias after claude: as --model", () => {
    const args = buildArgs(req("claude:sonnet", [{ role: "user", content: "x" }]));
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "sonnet"]);
  });

  it("replaces the program's own system prompt with the one given, or a plain default, and leaves out its extra tools and skills", () => {
    const given = buildArgs(req("claude", [{ role: "user", content: "x" }]), "be brief");
    expect(given).toEqual(expect.arrayContaining(["--system-prompt", "be brief", "--strict-mcp-config", "--disable-slash-commands"]));
    expect(given).not.toContain("--append-system-prompt");
    expect(buildArgs(req("claude", [{ role: "user", content: "x" }]))).toEqual(expect.arrayContaining(["--system-prompt", "You are a helpful assistant. Answer clearly and say so when you are not sure."]));
  });

  it("passes the effort on when one is chosen", () => {
    expect(buildArgs({ ...req("claude", [{ role: "user", content: "x" }]), effort: "high" })).toEqual(expect.arrayContaining(["--effort", "high"]));
    expect(buildArgs(req("claude", [{ role: "user", content: "x" }]))).not.toContain("--effort");
  });
});

describe("runClaude", () => {
  const r = req("claude:sonnet", [{ role: "user", content: "hi" }]);

  it("returns the result text and sends the prompt on stdin", async () => {
    const exec = vi.fn().mockResolvedValue(JSON.stringify({ result: "hello!", model: "claude-sonnet" }));
    await expect(runClaude("claude", r, exec)).resolves.toEqual({ text: "hello!", model: "claude-sonnet" });
    expect(exec).toHaveBeenCalledWith("claude", expect.any(Array), "hi");
  });

  it("throws when the CLI reports an error", async () => {
    const exec = vi.fn().mockResolvedValue(JSON.stringify({ is_error: true, result: "Not logged in" }));
    await expect(runClaude("claude", r, exec)).rejects.toThrow("Not logged in");
  });

  it("throws when the CLI output has no result", async () => {
    const exec = vi.fn().mockResolvedValue("{}");
    await expect(runClaude("claude", r, exec)).rejects.toThrow("no result");
  });

  it("propagates spawn failures", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("spawn claude ENOENT"));
    await expect(runClaude("claude", r, exec)).rejects.toThrow("ENOENT");
  });
});

describe("toOpenAIResponse", () => {
  it("wraps text in an OpenAI chat completion", () => {
    const out = toOpenAIResponse({ text: "yo", model: "m" });
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0]?.message).toEqual({ role: "assistant", content: "yo" });
  });
});

describe("carrying on the program's own conversation", () => {
  const turns = [
    { role: "user" as const, content: "first" },
    { role: "assistant" as const, content: "reply one" },
    { role: "user" as const, content: "second" },
  ];

  it("starts one the first time and keeps it, instead of keeping nothing", () => {
    const args = buildArgs({ ...req("claude", turns.slice(0, 1)), continuation: { id: "abc", seen: 0 } });
    expect(args).toEqual(expect.arrayContaining(["--session-id", "abc"]));
    expect(args).not.toContain("--no-session-persistence");
    expect(args).not.toContain("--resume");
  });

  it("resumes it on later steps and sends only the turns it has not seen", () => {
    const next = { ...req("claude", turns), continuation: { id: "abc", seen: 2 } };
    expect(buildArgs(next)).toEqual(expect.arrayContaining(["--resume", "abc"]));
    expect(toPrompt(next).prompt).toBe("User: second");
  });

  it("answers with where the conversation stands: every turn sent, and its own reply", async () => {
    const exec = vi.fn().mockResolvedValue(JSON.stringify({ result: "ok" }));
    const got = await runClaude("claude", { ...req("claude", turns), continuation: { id: "abc", seen: 2 } }, exec);
    expect(got.continuation).toEqual({ id: "abc", seen: 4 });
  });

  it("starts again from the whole transcript when the program no longer has the conversation", async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error("No conversation found")).mockResolvedValueOnce(JSON.stringify({ result: "ok" }));
    const got = await runClaude("claude", { ...req("claude", turns), continuation: { id: "abc", seen: 2 } }, exec);
    expect(exec).toHaveBeenCalledTimes(2);
    const second = exec.mock.calls[1] as [string, string[], string];
    expect(second[1]).toContain("--session-id");
    expect(second[2]).toContain("User: first");
    expect(got.continuation?.id).not.toBe("abc");
    expect(got.continuation?.seen).toBe(4);
  });

  it("does not retry a failure when there was nothing to resume", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Not logged in"));
    await expect(runClaude("claude", { ...req("claude", turns.slice(0, 1)), continuation: { id: "abc", seen: 0 } }, exec)).rejects.toThrow("Not logged in");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe("pruning old conversations", () => {
  it("removes only conversation files that have not been used for a while", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
    const old = path.join(dir, "old.jsonl");
    const fresh = path.join(dir, "fresh.jsonl");
    const other = path.join(dir, "notes.txt");
    for (const f of [old, fresh, other]) {
      fs.writeFileSync(f, "x");
    }
    const past = new Date(Date.now() - 10 * 24 * 3_600_000);
    fs.utimesSync(old, past, past);
    fs.utimesSync(other, past, past);
    expect(pruneConversations(3 * 24 * 3_600_000, dir)).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect(pruneConversations(1, path.join(dir, "missing"))).toBe(0);
  });

  it("names the program's folder for a working folder the way it does", () => {
    expect(conversationsDir("/tmp/torii-claude", "/home/me")).toBe(path.join("/home/me", ".claude", "projects", "-tmp-torii-claude"));
  });
});
