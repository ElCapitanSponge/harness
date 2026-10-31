#!/usr/bin/env tsx
import type { ChatMessage } from "@harness/core";
import readline from "node:readline/promises";
import { Gateway } from "./api.js";
import { parseCommand, USAGE } from "./commands.js";
import { formatModels, formatNodes } from "./format.js";
import { lms } from "./lms.js";

const gateway = new Gateway(process.env.GATEWAY_URL ?? "http://127.0.0.1:8787");

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
    const piped = await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data.trim()));
    });
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
