#!/usr/bin/env tsx
import type { ChatMessage, SessionEvent } from "@harness/core";
import readline from "node:readline/promises";
import { runTurn, systemPrompt, type Approver } from "@harness/tools";
import { Gateway } from "./api.js";
import { isClaudeModel, runClaudeCode } from "./claudecode.js";
import { parseCommand, USAGE } from "./commands.js";
import { formatModels, formatNodes } from "./format.js";
import { lms } from "./lms.js";

const gateway = new Gateway(process.env.GATEWAY_URL ?? "http://127.0.0.1:8787", fetch, process.env.HARNESS_API_KEY || undefined);

// pnpm runs scripts from the repo root, so the directory you called from arrives via HARNESS_CWD or pnpm's INIT_CWD.
const workingDir = process.env.HARNESS_CWD ?? process.env.INIT_CWD ?? process.cwd();

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function chatOnce(model: string, history: ChatMessage[]): Promise<void> {
  const reply = await gateway.chat(model, history);
  console.log(reply.text);
  console.error(`[${reply.node} / ${reply.model}]`);
  history.push({ role: "assistant", content: reply.text });
}

async function chat(model: string, prompt: string): Promise<void> {
  const history: ChatMessage[] = [];
  if (prompt) {
    history.push({ role: "user", content: prompt });
    return chatOnce(model, history);
  }
  if (!process.stdin.isTTY) {
    const piped = await readStdin();
    if (!piped) throw new Error("no prompt given");
    history.push({ role: "user", content: piped });
    return chatOnce(model, history);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.error(`chatting with "${model}" (empty line or Ctrl+C to quit)`);
  for (;;) {
    const line = (await rl.question("> ").catch(() => "")).trim();
    if (!line) break;
    history.push({ role: "user", content: line });
    try {
      await chatOnce(model, history);
    } catch (err) {
      history.pop();
      console.error(`error: ${(err as Error).message}`);
    }
  }
  rl.close();
}

// Works on a connected device's files: the model loop runs on the gateway, tools run on the device.
async function codeRemote(model: string, prompt: string, yes: boolean, device: string, rootName?: string): Promise<void> {
  const node = (await gateway.nodes()).find((n) => n.nodeId === device);
  if (!node) throw new Error(`device "${device}" is not connected`);
  const roots = node.roots ?? [];
  const root = rootName ?? (roots.length === 1 ? roots[0] : undefined);
  if (!root) throw new Error(roots.length ? `pick a project root with -r (${roots.join(", ")})` : `device "${device}" exposes no project roots`);

  const session = await gateway.createSession({ model, device, root, autoApprove: yes });
  console.error(`working on ${device}:${root} with "${model}"${yes ? " (auto-approving changes)" : ""}`);

  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  // Events already shown, so a later turn does not replay earlier ones.
  let cursor = 0;
  const ask = async (event: Extract<SessionEvent, { type: "approval" }>): Promise<void> => {
    let approve = false;
    let always = false;
    if (rl) {
      const answer = (await rl.question(`  allow ${event.summary}? [y/N/a = always allow ${event.tool}] `).catch(() => "")).trim().toLowerCase();
      always = answer === "a";
      approve = always || answer === "y" || answer === "yes";
    }
    await gateway.answerApproval(session.id, event.id, approve, always);
  };
  const turn = async (text: string): Promise<void> => {
    const abort = new AbortController();
    const onInt = () => void gateway.cancelSession(session.id).catch(() => undefined);
    process.once("SIGINT", onInt);
    try {
      await gateway.sendMessage(session.id, text);
      for await (const event of gateway.sessionEvents(session.id, cursor, abort.signal)) {
        cursor++;
        if (event.type === "text") console.log(event.text);
        else if (event.type === "tool") console.error(`  > ${event.summary}`);
        else if (event.type === "approval") await ask(event);
        else if (event.type === "error") console.error(`error: ${event.message}`);
        else if (event.type === "cancelled") console.error("(cancelled)");
        else if (event.type === "done") {
          if (event.declined) console.error("(declined; nothing was changed. Tell me what to do instead)");
          else if (event.stopped) console.error("(stopped at the step limit; say 'continue' to go on)");
          break;
        }
        if (event.type === "error" || event.type === "cancelled") break;
      }
    } finally {
      process.removeListener("SIGINT", onInt);
      abort.abort();
    }
  };

  if (prompt) {
    await turn(prompt);
    rl?.close();
    return;
  }
  if (!rl) {
    const piped = await readStdin();
    if (!piped) throw new Error("no prompt given");
    return turn(piped);
  }
  console.error("(empty line or Ctrl+C to quit)");
  for (;;) {
    const line = (await rl.question("> ").catch(() => "")).trim();
    if (!line) break;
    await turn(line);
  }
  rl.close();
}

async function code(model: string, prompt: string, yes: boolean): Promise<void> {
  if (isClaudeModel(model)) return runClaudeCode(model, prompt);

  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const always = new Set<string>();

  const approve: Approver = async (tool, summary) => {
    if (yes || always.has(tool)) return true;
    if (!rl) return false;
    const answer = (await rl.question(`  allow ${summary}? [y/N/a = always allow ${tool}] `).catch(() => "")).trim().toLowerCase();
    if (answer === "a") {
      always.add(tool);
      return true;
    }
    return answer === "y" || answer === "yes";
  };

  const history: ChatMessage[] = [{ role: "system", content: systemPrompt(workingDir) }];
  const deps = {
    complete: async (messages: ChatMessage[], tools: Parameters<Gateway["complete"]>[2]) => (await gateway.complete(model, messages, tools)).message,
    approve,
    ctx: { cwd: workingDir },
    onText: (text: string) => console.log(text),
    onTool: (summary: string) => console.error(`  > ${summary}`),
  };

  const turn = async (text: string) => {
    history.push({ role: "user", content: text });
    try {
      const outcome = await runTurn(history, deps);
      if (outcome.declined) console.error("(declined; nothing was changed. Tell me what to do instead)");
      else if (outcome.stopped) console.error("(stopped at the step limit; say 'continue' to go on)");
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
    }
  };

  console.error(`working in ${workingDir} with "${model}"${yes ? " (auto-approving changes)" : ""}`);
  if (prompt) {
    await turn(prompt);
  } else if (!rl) {
    const piped = await readStdin();
    if (!piped) throw new Error("no prompt given");
    await turn(piped);
  } else {
    console.error("(empty line or Ctrl+C to quit)");
    for (;;) {
      const line = (await rl.question("> ").catch(() => "")).trim();
      if (!line) break;
      await turn(line);
    }
  }
  rl?.close();
}

async function main(): Promise<void> {
  const cmd = parseCommand(process.argv.slice(2));
  switch (cmd.name) {
    case "help":
      console.log(USAGE);
      return;
    case "nodes":
      console.log(formatNodes(await gateway.nodes()));
      return;
    case "models":
      console.log(formatModels(await gateway.nodes()));
      return;
    case "chat":
      return chat(cmd.model, cmd.prompt);
    case "code":
      return cmd.device ? codeRemote(cmd.model, cmd.prompt, cmd.yes, cmd.device, cmd.root) : code(cmd.model, cmd.prompt, cmd.yes);
    case "tool": {
      const result = await gateway.deviceTool(cmd.device, cmd.root, cmd.tool, cmd.args);
      console.log(result.output);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "load":
      await lms.serverStart().catch(() => undefined);
      console.log(await lms.load(cmd.model, cmd.contextLength));
      return;
    case "unload":
      console.log(await lms.unload(cmd.model));
      return;
  }
}

main().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
