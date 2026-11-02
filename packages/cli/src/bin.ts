#!/usr/bin/env tsx
import { isLiveEvent, nonEmpty, type ChatMessage, type SessionEvent, type SessionInfo, type StageName } from "@harness/core";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { runTurn, systemPrompt, type Approver } from "@harness/tools";
import { Gateway } from "./api.js";
import { isClaudeModel, runClaudeCode } from "./claudecode.js";
import { parseCommand, USAGE } from "./commands.js";
import { pickSession } from "./resume.js";
import { formatModels, formatNodes, formatSessions, formatSettings } from "./format.js";
import { lms } from "@harness/lmstudio";

const gateway = new Gateway(process.env.GATEWAY_URL ?? "http://127.0.0.1:8787", fetch, nonEmpty(process.env.HARNESS_API_KEY));

// pnpm runs scripts from the repo root, so the directory you called from arrives via HARNESS_CWD or pnpm's INIT_CWD.
const workingDir = process.env.HARNESS_CWD ?? process.env.INIT_CWD ?? process.cwd();

const readStdin = (): Promise<string> => {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c: Buffer | string) => {
      data += c.toString();
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
  });
};

// What a stage means in words; thinking and writing are visible in the output itself.
const stageText = (stage: StageName, detail?: string): string => {
  switch (stage) {
    case "routing":
      return "finding a device";
    case "freeing":
      return `freeing memory (unloading ${detail ?? "a model"})`;
    case "loading":
      return `loading ${detail ?? "the model"}`;
    case "waiting":
      return `waiting for ${detail ?? "the model"}`;
    default:
      return "";
  }
};

const chatOnce = async (model: string, history: ChatMessage[]): Promise<void> => {
  const reply = await gateway.chat(model, history);
  console.log(reply.text);
  console.error(`[${reply.node} / ${reply.model}]`);
  history.push({ role: "assistant", content: reply.text });
};

const chat = async (model: string, prompt: string): Promise<void> => {
  const history: ChatMessage[] = [];
  if (prompt) {
    history.push({ role: "user", content: prompt });
    return chatOnce(model, history);
  }
  if (!process.stdin.isTTY) {
    const piped = await readStdin();
    if (!piped) {
      throw new Error("no prompt given");
    }
    history.push({ role: "user", content: piped });
    return chatOnce(model, history);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.error(`chatting with "${model}" (empty line or Ctrl+C to quit)`);
  for (;;) {
    const line = (await rl.question("> ").catch(() => {
      return "";
    })).trim();
    if (!line) {
      break;
    }
    history.push({ role: "user", content: line });
    try {
      await chatOnce(model, history);
    } catch (err) {
      history.pop();
      console.error(`error: ${(err as Error).message}`);
    }
  }
  rl.close();
};

// Works on a connected device's files: the model loop runs on the gateway, tools run on the device.
const codeRemote = async (model: string, prompt: string, yes: boolean, device: string, rootName?: string, back?: SessionInfo): Promise<void> => {
  if (back) {
    return codeSession(back, prompt);
  }
  const node = (await gateway.nodes()).find((n) => {
    return n.nodeId === device;
  });
  if (!node) {
    throw new Error(`device "${device}" is not connected`);
  }
  const roots = node.roots ?? [];
  const root = rootName ?? (roots.length === 1 ? roots[0] : undefined);
  if (!root) {
    throw new Error(roots.length ? `pick a project root with -r (${roots.join(", ")})` : `device "${device}" exposes no project roots`);
  }

  const session = await gateway.createSession({ model, device, root, autoApprove: yes });
  console.error(`working on ${device}:${root} with "${model}"${yes ? " (auto-approving changes)" : ""}`);
  return codeSession(session, prompt);
};

// Talks to a coding session on the gateway, a new one or one gone back to; earlier events are not shown again.
const codeSession = async (session: SessionInfo, prompt: string): Promise<void> => {
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  // Events already shown, so a later turn does not replay earlier ones.
  let cursor = session.events;
  let lastStage = "";
  const ask = async (event: Extract<SessionEvent, { type: "approval" }>): Promise<void> => {
    let approve = false;
    let always = false;
    if (rl) {
      const answer = (await rl.question(`  allow ${event.summary}? [y/N/a = always allow ${event.tool}] `).catch(() => {
        return "";
      })).trim().toLowerCase();
      always = answer === "a";
      approve = always || answer === "y" || answer === "yes";
    }
    await gateway.answerApproval(session.id, event.id, approve, always);
  };
  const turn = async (text: string): Promise<void> => {
    const abort = new AbortController();
    const onInt = () => {
      return void gateway.cancelSession(session.id).catch(() => {
        return undefined;
      });
    };
    process.once("SIGINT", onInt);
    try {
      await gateway.sendMessage(session.id, text);
      for await (const event of gateway.sessionEvents(session.id, cursor, abort.signal)) {
        // Where the request is before the first word, so a slow model load is not mistaken for a hang.
        if (event.type === "stage") {
          const text = stageText(event.stage, event.detail);
          if (text && text !== lastStage) {
            lastStage = text;
            console.error(`  ... ${text}`);
          }
          continue;
        }
        if (isLiveEvent(event)) {
          continue;
        }
        cursor++;
        if (event.type === "text") {
          console.log(event.text);
        } else if (event.type === "tool") {
          console.error(`  > ${event.summary}`);
        } else if (event.type === "approval") {
          await ask(event);
        } else if (event.type === "error") {
          console.error(`error: ${event.message}`);
        } else if (event.type === "cancelled") {
          console.error("(cancelled)");
        } else if (event.type === "done") {
          if (event.declined) {
            console.error("(declined; nothing was changed. Tell me what to do instead)");
          } else if (event.stopped) {
            console.error("(stopped at the step limit; say 'continue' to go on)");
          }
          break;
        }
        if (event.type === "error" || event.type === "cancelled") {
          break;
        }
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
    if (!piped) {
      throw new Error("no prompt given");
    }
    return turn(piped);
  }
  console.error("(empty line or Ctrl+C to quit)");
  for (;;) {
    const line = (await rl.question("> ").catch(() => {
      return "";
    })).trim();
    if (!line) {
      break;
    }
    await turn(line);
  }
  rl.close();
};

const code = async (model: string, prompt: string, yes: boolean): Promise<void> => {
  if (isClaudeModel(model)) {
    return runClaudeCode(model, prompt);
  }

  const interactive = process.stdin.isTTY;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const always = new Set<string>();

  const approve: Approver = async (tool, summary) => {
    if (yes || always.has(tool)) {
      return true;
    }
    if (!rl) {
      return false;
    }
    const answer = (await rl.question(`  allow ${summary}? [y/N/a = always allow ${tool}] `).catch(() => {
      return "";
    })).trim().toLowerCase();
    if (answer === "a") {
      always.add(tool);
      return true;
    }
    return answer === "y" || answer === "yes";
  };

  const history: ChatMessage[] = [{ role: "system", content: systemPrompt(workingDir) }];
  const deps = {
    complete: async (messages: ChatMessage[], tools: Parameters<Gateway["complete"]>[2]) => {
      return (await gateway.complete(model, messages, tools)).message;
    },
    approve,
    ctx: { cwd: workingDir },
    onText: (text: string) => {
      console.log(text);
    },
    onTool: (summary: string) => {
      console.error(`  > ${summary}`);
    },
  };

  const turn = async (text: string) => {
    history.push({ role: "user", content: text });
    try {
      const outcome = await runTurn(history, deps);
      if (outcome.declined) {
        console.error("(declined; nothing was changed. Tell me what to do instead)");
      } else if (outcome.stopped) {
        console.error("(stopped at the step limit; say 'continue' to go on)");
      }
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
    }
  };

  console.error(`working in ${workingDir} with "${model}"${yes ? " (auto-approving changes)" : ""}`);
  if (prompt) {
    await turn(prompt);
  } else if (!rl) {
    const piped = await readStdin();
    if (!piped) {
      throw new Error("no prompt given");
    }
    await turn(piped);
  } else {
    console.error("(empty line or Ctrl+C to quit)");
    for (;;) {
      const line = (await rl.question("> ").catch(() => {
        return "";
      })).trim();
      if (!line) {
        break;
      }
      await turn(line);
    }
  }
  rl?.close();
};

const main = async (): Promise<void> => {
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
    case "sessions":
      console.log(formatSessions(await gateway.sessions()));
      return;
    case "export":
      process.stdout.write(await gateway.exportSession(cmd.id));
      return;
    case "import": {
      const parsed = await gateway.parseImport(path.basename(cmd.file), await fs.readFile(cmd.file, "utf8"));
      const all = parsed.conversations;
      if (!parsed.split) {
        console.error("Could not split that text into turns; importing it as one message from you.");
      }
      if (all.length > 1 && !cmd.all && cmd.pick === undefined) {
        console.log(`${String(all.length)} conversations in that file. Choose one with -n <number>, or take them all with --all:`);
        all.forEach((c, i) => {
          console.log(`  ${String(i + 1)}. ${c.title} (${c.source}, ${String(c.turns.length)} messages)`);
        });
        return;
      }
      const chosen = cmd.all ? all : all.slice((cmd.pick ?? 1) - 1, cmd.pick ?? 1);
      if (chosen.length === 0) {
        throw new Error(`there is no conversation number ${String(cmd.pick)} in that file`);
      }
      for (const c of chosen) {
        const info = await gateway.importConversation({ title: c.title, source: c.source, turns: c.turns, model: cmd.model });
        console.log(`imported "${c.title}" as ${info.id}`);
      }
      return;
    }
    case "settings":
      console.log(formatSettings(await gateway.deviceSettings(cmd.device, cmd.key === undefined ? undefined : { [cmd.key]: cmd.value })));
      return;
    case "chat":
      return chat(cmd.model, cmd.prompt);
    case "code": {
      if (cmd.resume || cmd.continue) {
        const back = pickSession(await gateway.sessions(), { resume: cmd.resume, continue: cmd.continue, device: cmd.device, root: cmd.root });
        if (!back.deviceConnected) {
          throw new Error(`${back.device} is not connected, so that session cannot be continued`);
        }
        console.error(`continuing ${back.id.slice(0, 8)} on ${back.device}:${back.root} with "${back.model}"`);
        return codeRemote(back.model, cmd.prompt, cmd.yes, back.device, back.root, back);
      }
      return cmd.device ? codeRemote(cmd.model, cmd.prompt, cmd.yes, cmd.device, cmd.root) : code(cmd.model, cmd.prompt, cmd.yes);
    }
    case "tool": {
      const result = await gateway.deviceTool(cmd.device, cmd.root, cmd.tool, cmd.args);
      console.log(result.output);
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }
    case "load":
      if (cmd.device) {
        console.log(await gateway.deviceModel(cmd.device, "load", { model: cmd.model, contextLength: cmd.contextLength }));
        return;
      }
      await lms.serverStart().catch(() => {
        return undefined;
      });
      console.log(await lms.load(cmd.model, cmd.contextLength));
      return;
    case "unload":
      if (cmd.device) {
        console.log(await gateway.deviceModel(cmd.device, "unload", { model: cmd.model }));
        return;
      }
      console.log(await lms.unload(cmd.model));
      return;
  }
};

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
