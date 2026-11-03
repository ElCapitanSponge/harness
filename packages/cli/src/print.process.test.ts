import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// These run the real command line (bin.ts) against a gateway that answers from a script, so they check what a script calling
// `harness code -p` sees: stdout, stderr and the exit code. Before print mode every outcome exited 0 (the turn's result was dropped and
// only a failure before the turn, such as no prompt, exited 1); the exit codes asserted here are the new contract.

const root = path.resolve(import.meta.dirname, "../../..");
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const bin = path.join(root, "packages", "cli", "src", "bin.ts");

interface Reply {
  status?: number;
  body: unknown;
}

interface Fake {
  // What the gateway answers to each model call, in order; the last is repeated.
  completions: Reply[];
  // What a coding session on a device streams back.
  events: unknown[];
  // The answers given to approvals, as the gateway received them.
  approvals: unknown[];
}

let fake: Fake = { completions: [], events: [], approvals: [] };
let calls = 0;
let server: http.Server;
let url = "";
let dir = "";

const readBody = (req: http.IncomingMessage): Promise<string> => {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      resolve(data);
    });
  });
};

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const route = `${req.method ?? ""} ${(req.url ?? "").split("?")[0] ?? ""}`;
      if (route === "POST /v1/chat/completions") {
        const reply = fake.completions[Math.min(calls, fake.completions.length - 1)];
        calls++;
        sendJson(res, reply?.status ?? 200, reply?.body);
      } else if (route === "GET /nodes") {
        sendJson(res, 200, [{ nodeId: "dev", roots: ["proj"] }]);
      } else if (route === "POST /sessions") {
        sendJson(res, 200, { id: "s1", model: "fake-model", device: "dev", root: "proj", events: 0 });
      } else if (route === "POST /sessions/s1/messages") {
        sendJson(res, 200, {});
      } else if (route === "GET /sessions/s1/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(fake.events.map((event) => {
          return `data: ${JSON.stringify(event)}\n\n`;
        }).join(""));
      } else if (route.startsWith("POST /sessions/s1/approvals/")) {
        fake.approvals.push(JSON.parse(body));
        sendJson(res, 200, {});
      } else {
        sendJson(res, 404, { error: { message: `no route for ${route}` } });
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  fake = { completions: [], events: [], approvals: [] };
  calls = 0;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-print-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Runs the command line with no terminal on any of its streams, in a folder of its own.
const harness = (args: string[], stdin = ""): Promise<Run> => {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, bin, ...args], {
      cwd: root,
      env: { ...process.env, GATEWAY_URL: url, HARNESS_API_KEY: "", HARNESS_CWD: dir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
};

const say = (content: string): Reply => {
  return { body: { model: "fake-model", choices: [{ message: { role: "assistant", content } }] } };
};

const call = (name: string, args: Record<string, unknown>, content = ""): Reply => {
  return { body: { model: "fake-model", choices: [{ message: { role: "assistant", content, tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] } };
};

const write = (): Reply => {
  return call("write_file", { path: "out.txt", content: "hi" });
};

const exists = (file: string): Promise<boolean> => {
  return fs.access(path.join(dir, file)).then(() => {
    return true;
  }, () => {
    return false;
  });
};

describe("harness code -p", { timeout: 60_000 }, () => {
  it("exits 0 with only the final reply on stdout when the turn is done", async () => {
    fake.completions = [call("list_dir", { path: "." }, "Let me look."), say("All fixed.")];
    const run = await harness(["code", "-p", "-m", "fake-model", "fix it"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("All fixed.\n");
    // The reply written before the tool call is progress, so it is on stderr.
    expect(run.stderr).toContain("Let me look.");
    expect(run.stderr).toContain("> ");
  });

  it("declines a change without -y, reports it, and exits non-zero", async () => {
    fake.completions = [write(), say("unused")];
    const run = await harness(["code", "-p", "-m", "fake-model", "write a file"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("declined");
    expect(await exists("out.txt")).toBe(false);
    expect(run.stdout).toBe("");
  });

  it("runs the change with -y and exits 0", async () => {
    fake.completions = [write(), say("Written.")];
    const run = await harness(["code", "-p", "-y", "-m", "fake-model", "write a file"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("Written.\n");
    expect(await exists("out.txt")).toBe(true);
  });

  it("exits non-zero when the turn stops at the step limit", async () => {
    fake.completions = [call("list_dir", { path: "." })];
    const run = await harness(["code", "-p", "-m", "fake-model", "go on forever"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("step limit");
    expect(calls).toBe(25);
  });

  it("exits non-zero when the gateway fails", async () => {
    fake.completions = [{ status: 500, body: { error: { message: "model down" } } }];
    const run = await harness(["code", "-p", "-m", "fake-model", "hello"]);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("model down");
    expect(run.stdout).toBe("");
  });

  it("prints one JSON object for each outcome with --output-format json", async () => {
    const outcomes: { replies: Reply[]; args: string[]; expected: Record<string, unknown> }[] = [
      { replies: [say("All fixed.")], args: [], expected: { outcome: "done", text: "All fixed.", model: "fake-model" } },
      { replies: [write()], args: [], expected: { outcome: "declined", text: "", model: "fake-model" } },
      { replies: [call("list_dir", { path: "." })], args: [], expected: { outcome: "stopped", text: "", model: "fake-model" } },
      { replies: [{ status: 500, body: { error: { message: "model down" } } }], args: [], expected: { outcome: "error", text: "", model: "fake-model", error: "model down" } },
    ];
    for (const { replies, args, expected } of outcomes) {
      fake.completions = replies;
      calls = 0;
      const run = await harness(["code", "-p", "--output-format", "json", "-m", "fake-model", ...args, "go"]);
      expect(run.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(run.stdout)).toEqual(expected);
      expect(run.code).toBe(expected.outcome === "done" ? 0 : 1);
    }
  });

  it("reads the prompt from a pipe, and fails rather than waits when there is none", async () => {
    fake.completions = [say("From a pipe.")];
    const piped = await harness(["code", "-p", "-m", "fake-model"], "summarise");
    expect(piped.code).toBe(0);
    expect(piped.stdout).toBe("From a pipe.\n");

    const none = await harness(["code", "-p", "-m", "fake-model"]);
    expect(none.code).not.toBe(0);
    expect(none.stderr).toContain("no prompt");
  });

  it("rejects --output-format without -p, and a format that does not exist", async () => {
    const without = await harness(["code", "--output-format", "json", "hi"]);
    expect(without.code).not.toBe(0);
    expect(without.stderr).toContain("--output-format only works with --print");
    const bad = await harness(["code", "-p", "--output-format", "xml", "hi"]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("text or json");
  });
});

describe("harness code -p on a device", { timeout: 60_000 }, () => {
  const approval = { type: "approval", id: "a1", tool: "write_file", summary: "write out.txt" };

  it("exits 0 with only the final reply on stdout when the turn is done", async () => {
    fake.events = [{ type: "text", text: "Looking." }, { type: "tool", summary: "read a.txt" }, { type: "text", text: "All fixed." }, { type: "done", stopped: false }];
    const run = await harness(["code", "-p", "-d", "dev", "-r", "proj", "-m", "fake-model", "fix it"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("All fixed.\n");
    expect(run.stderr).toContain("Looking.");
  });

  it("answers an approval no without -y and yes with it", async () => {
    fake.events = [approval, { type: "done", stopped: false, declined: true }];
    const declined = await harness(["code", "-p", "-d", "dev", "-r", "proj", "-m", "fake-model", "write"]);
    expect(declined.code).not.toBe(0);
    expect(fake.approvals).toEqual([{ approve: false, always: false }]);

    fake.approvals = [];
    fake.events = [approval, { type: "text", text: "Written." }, { type: "done", stopped: false }];
    const approved = await harness(["code", "-p", "-y", "-d", "dev", "-r", "proj", "-m", "fake-model", "write"]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toBe("Written.\n");
    expect(fake.approvals).toEqual([{ approve: true, always: false }]);
  });

  it("exits non-zero for a turn stopped at the step limit, and for an error, with the outcome in JSON", async () => {
    fake.events = [{ type: "done", stopped: true }];
    const stopped = await harness(["code", "-p", "--output-format", "json", "-d", "dev", "-r", "proj", "-m", "fake-model", "go"]);
    expect(stopped.code).not.toBe(0);
    expect(JSON.parse(stopped.stdout)).toEqual({ outcome: "stopped", text: "", model: "fake-model" });

    fake.events = [{ type: "error", message: "model down" }];
    const failed = await harness(["code", "-p", "--output-format", "json", "-d", "dev", "-r", "proj", "-m", "fake-model", "go"]);
    expect(failed.code).not.toBe(0);
    expect(JSON.parse(failed.stdout)).toEqual({ outcome: "error", text: "", model: "fake-model", error: "model down" });
  });

  it("reports a device that is not connected the way a script asked for", async () => {
    const run = await harness(["code", "-p", "--output-format", "json", "-d", "nowhere", "-m", "fake-model", "go"]);
    expect(run.code).not.toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ outcome: "error", error: expect.stringContaining("not connected") as unknown });
  });
});
