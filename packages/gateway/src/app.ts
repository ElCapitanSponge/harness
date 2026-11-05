import { toOpenAIResponse, toSse } from "@harness/claude";
import { ChatRequest, DeviceToolRequest, ModelLoad, ModelUnload, ImportParse, LibraryImport, QueuedEdit, SessionAnswer, SessionApproval, SessionCreate, SessionMode, SessionImport, SessionMessage, SessionRead, SessionRename, InstructionSave, INSTRUCTION_NAMES, flattenError, type InstructionName } from "@harness/core";
import { findTool, type ProjectContext } from "@harness/tools";
import { Hono, type Context } from "hono";
import { bearerAuth } from "./auth.js";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { ModelLoader } from "./loader.js";
import { CLAUDE_MODEL_IDS, catalogue, isClaudeModel } from "./router.js";
import { RouteError, resolveRoute } from "./routing.js";
import type { UsageLedger } from "./ledger.js";
import { ClaudeState, ClaudeUnavailableError, askClaude } from "./claude.js";
import type { PermissionRule } from "./sqlite.js";
import os from "node:os";
import { callerAddress, looksLikeContainerNetwork, onOwnContainerNetwork, type Interface } from "./address.js";
import { LibraryConflict, LibraryError, type Library } from "./library.js";
import type { Sessions } from "./sessions.js";
import { parseImportFile, toMarkdown } from "./transcripts.js";
import { WEB_PAGE } from "./web.js";

export interface AppDeps {
  registry: Registry;
  apiKey?: string;
  relay: Pick<Relay, "request" | "callTool" | "callClaude" | "callModel" | "callSettings">;
  sessions: Sessions;
  // The gateway's own skills, available in every conversation. Without it the library routes answer 404.
  library?: Library;
  // The tools the person said to always allow in a folder on a device. Without it the rules routes answer empty.
  rules?: { list(): PermissionRule[]; remove(id: number): boolean };
  // The project groups the person collapsed in the sidebar. Without it the routes answer empty and remember nothing.
  groups?: { list(): { device: string; root: string }[]; set(device: string, root: string, collapsed: boolean): void };
  // Believe X-Forwarded-For (set only behind a reverse proxy you run), so a browser's real address is seen.
  trustProxy?: boolean;
  // The gateway's own network interfaces, to tell a container network from a real one (replaced in tests).
  interfaces?: () => Interface[];
  // Every model call, for the usage routes. Without it the routes report nothing.
  ledger?: UsageLedger;
  // What is known of the Claude plan: its windows, and whether Claude is limited right now.
  claude?: ClaudeState;
  loader: Pick<ModelLoader, "ensure">;
  // Mounts the built web app. Without it the page is the single-file one in web.ts.
  mountWeb?: (app: Hono) => void;
}

export const createApp = ({ registry, apiKey, relay, sessions, library, rules, groups, trustProxy = false, interfaces = (): Interface[] => {
  return Object.values(os.networkInterfaces()).flatMap((list) => {
    return list ?? [];
  });
}, ledger, claude = new ClaudeState(), loader, mountWeb }: AppDeps): Hono => {
  const app = new Hono();

  // The page holds no secrets and must load before a key can be typed, so it is registered ahead of the auth middleware.
  if (mountWeb) {
    mountWeb(app);
  } else {
    app.get("/", (c) => {
      return c.html(WEB_PAGE, 200, {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
    });
  }

  if (apiKey) {
    app.use("*", bearerAuth(apiKey));
  }

  app.get("/nodes", (c) => {
    return c.json(registry.live());
  });

  // Runs one read-only tool on a connected device. The device also decides which roots and tools it allows.
  app.post("/devices/:nodeId/tools", async (c) => {
    const parsed = DeviceToolRequest.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    // Changes go through a coding session, where they wait for an approval. This endpoint is for looking around.
    const spec = findTool(parsed.data.name);
    if (!spec || spec.needsApproval) {
      return c.json({ error: { message: `"${parsed.data.name}" is not a read-only tool; start a coding session to make changes` } }, 403);
    }
    const nodeId = c.req.param("nodeId");
    if (!registry.live().some((n) => {
      return n.nodeId === nodeId;
    })) {
      return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
    }
    try {
      return c.json(await relay.callTool(nodeId, parsed.data.root, parsed.data.name, parsed.data.args));
    } catch (err) {
      return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
    }
  });

  // Loads or unloads a model in a device's LM Studio. The device must have switched this on.
  const modelControl = (op: "load" | "unload") => {
    return async (c: Context) => {
      const parsed = (op === "load" ? ModelLoad : ModelUnload).safeParse(await c.req.json().catch(() => {
        return undefined;
      }));
      if (!parsed.success) {
        return c.json({ error: flattenError(parsed.error) }, 400);
      }
      const nodeId = c.req.param("nodeId") ?? "";
      const node = registry.live().find((n) => {
        return n.nodeId === nodeId;
      });
      if (!node) {
        return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
      }
      if (!node.modelControl) {
        return c.json({ error: { message: `device "${nodeId}" does not allow remote model control (start its agent with ALLOW_MODEL_CONTROL=1)` } }, 403);
      }
      const input = parsed.data as { model?: string; contextLength?: number };
      try {
        return c.json(await relay.callModel(nodeId, op, input.model, input.contextLength));
      } catch (err) {
        return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
      }
    };
  };
  app.post("/devices/:nodeId/models/load", modelControl("load"));
  app.post("/devices/:nodeId/models/unload", modelControl("unload"));

  // A device's effective settings, and changes to them. The device checks it was started to accept changes.
  const deviceSettings = (op: "get" | "set") => {
    return async (c: Context) => {
      const nodeId = c.req.param("nodeId") ?? "";
      if (!registry.live().some((n) => {
        return n.nodeId === nodeId;
      })) {
        return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
      }
      let patch: Record<string, unknown> | undefined;
      if (op === "set") {
        const body: unknown = await c.req.json().catch(() => {
          return undefined;
        });
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return c.json({ error: { message: "send an object of settings to change" } }, 400);
        }
        patch = body as Record<string, unknown>;
      }
      try {
        const result = await relay.callSettings(nodeId, op, patch);
        if (!result.ok) {
          return c.json({ error: { message: result.output } }, 422);
        }
        return c.json(JSON.parse(result.output));
      } catch (err) {
        return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
      }
    };
  };
  app.get("/devices/:nodeId/settings", deviceSettings("get"));
  app.put("/devices/:nodeId/settings", deviceSettings("set"));

  // What the models have used. `days` counts local days ending today; `offset` is the caller's minutes ahead of UTC, so days
  // start at the caller's midnight.
  app.get("/usage", (c) => {
    const days = Math.min(Math.max(Math.trunc(Number(c.req.query("days") ?? "7")) || 7, 1), 366);
    const offset = Math.trunc(Number(c.req.query("offset") ?? "0")) || 0;
    return c.json(ledger?.summary(days, Date.now(), offset) ?? { days, since: 0, calls: 0, promptTokens: 0, completionTokens: 0, byModel: [], byDevice: [], byDay: [] });
  });

  app.get("/sessions/:id/usage", (c) => {
    const id = c.req.param("id");
    const session = sessions.get(id);
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const usage = { ...(ledger?.forConversation(id) ?? { byModel: [] }), compactAt: sessions.compactAt };
    // After a compaction the history is smaller than the last call saw, so show that until the next reply says exactly.
    if (usage.last && session.compaction && session.compaction.time >= usage.last.time) {
      return c.json({ ...usage, last: { ...usage.last, promptTokens: session.compaction.tokensAfter, completionTokens: 0, estimated: true } });
    }
    return c.json(usage);
  });

  // Summarises the older turns now, to free context. The conversation shown stays whole; only what the model is sent shrinks.
  app.post("/sessions/:id/compact", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const outcome = await session.compact();
    if (!outcome.ok) {
      return c.json({ error: { message: outcome.reason } }, outcome.reason.includes("busy") ? 409 : 422);
    }
    return c.json(outcome);
  });

  // Coding sessions: the model loop runs here, tool calls run on the chosen device.
  // Splits pasted text or a dropped file into the turns it finds, for the person to check. Nothing is saved.
  app.post("/import/parse", async (c) => {
    const parsed = ImportParse.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(parseImportFile(parsed.data.name ?? "pasted.txt", parsed.data.content));
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 422);
    }
  });

  app.post("/sessions/import", async (c) => {
    const parsed = SessionImport.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(sessions.import(parsed.data).info(), 201);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 422);
    }
  });

  app.get("/sessions/:id/export", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const name = session.title.replace(/[^\w -]+/g, "").trim().slice(0, 60) || "conversation";
    return c.body(toMarkdown(session.title, session.events), 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` });
  });

  app.get("/sessions", (c) => {
    return c.json(sessions.list());
  });

  app.post("/sessions", async (c) => {
    const parsed = SessionCreate.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(sessions.create(parsed.data).info(), 201);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 400);
    }
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionMessage.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      session.send(parsed.data.text, parsed.data.model, parsed.data.effort, parsed.data.skill, parsed.data.images);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 409);
    }
    return c.json(session.info(), 202);
  });

  // Messages sent while a turn was running wait here until it ends. They can be reworded, taken back, or sent at once.
  app.patch("/sessions/:id/queue/:queueId", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = QueuedEdit.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    if (!session.editQueued(c.req.param("queueId"), parsed.data.text)) {
      return c.json({ error: { message: "that message is no longer waiting" } }, 404);
    }
    return c.json(session.info());
  });

  app.delete("/sessions/:id/queue/:queueId", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    if (!session.removeQueued(c.req.param("queueId"))) {
      return c.json({ error: { message: "that message is no longer waiting" } }, 404);
    }
    return c.json(session.info());
  });

  app.post("/sessions/:id/queue/:queueId/send", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    try {
      if (!session.sendQueuedNow(c.req.param("queueId"))) {
        return c.json({ error: { message: "that message is no longer waiting" } }, 404);
      }
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 409);
    }
    return c.json(session.info(), 202);
  });

  app.post("/sessions/:id/questions/:questionId", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionAnswer.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    if (!session.answerQuestion(c.req.param("questionId"), parsed.data.answer)) {
      return c.json({ error: { message: "no such question (already answered or timed out)" } }, 404);
    }
    return c.json({ ok: true });
  });

  // How this conversation treats changes: ask, edits, plan or bypass.
  app.put("/sessions/:id/mode", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionMode.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      session.setMode(parsed.data.mode);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 403);
    }
    return c.json(session.info());
  });

  // Which project groups are collapsed in the sidebar, kept here so the browser and the desktop app agree.
  app.get("/sidebar/collapsed", (c) => {
    return c.json(groups?.list() ?? []);
  });

  app.put("/sidebar/collapsed", async (c) => {
    const body = await c.req.json().catch(() => {
      return undefined;
    }) as { device?: unknown; root?: unknown; collapsed?: unknown } | undefined;
    if (typeof body?.device !== "string" || typeof body.root !== "string" || typeof body.collapsed !== "boolean") {
      return c.json({ error: { message: "device, root and collapsed are required" } }, 400);
    }
    groups?.set(body.device, body.root, body.collapsed);
    return c.json({ ok: true });
  });

  // The tools remembered as always allowed in a folder on a device, and removing one.
  app.get("/rules", (c) => {
    return c.json(rules?.list() ?? []);
  });

  app.delete("/rules/:id", (c) => {
    if (!rules?.remove(Number(c.req.param("id")))) {
      return c.json({ error: { message: "no such rule" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/approvals/:approvalId", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionApproval.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    if (!session.answer(c.req.param("approvalId"), parsed.data.approve, parsed.data.always, parsed.data.reason, { edited: parsed.data.plan, next: parsed.data.next })) {
      return c.json({ error: { message: "no such pending approval" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.patch("/sessions/:id", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const parsed = SessionRename.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    if (parsed.data.title !== undefined) {
      session.rename(parsed.data.title);
    }
    if (parsed.data.pinned !== undefined) {
      session.setPinned(parsed.data.pinned);
    }
    if (parsed.data.archived !== undefined) {
      session.setArchived(parsed.data.archived);
    }
    return c.json(session.info());
  });

  // The commands a coding session has running in the background, as its device reports them. A chat, or a device that is offline or
  // too old to answer, has none.
  // The person has read a conversation up to this many events, so every client can clear it.
  app.put("/sessions/:id/read", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const parsed = SessionRead.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    session.markRead(parsed.data.events);
    return c.json(session.info());
  });

  app.get("/sessions/:id/tasks", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    if (session.device === "") {
      return c.json([]);
    }
    try {
      const result = await relay.callTool(session.device, session.root, "tasks_list", {}, { session: session.id, timeoutMs: 10_000 });
      return c.json(result.ok ? JSON.parse(result.output) as unknown : []);
    } catch {
      return c.json([]);
    }
  });

  // Forget the session's background tasks that have ended, on its device. Running ones are kept. A device on an older agent has no such tool.
  app.delete("/sessions/:id/tasks/finished", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    if (session.device === "") {
      return c.json({ cleared: 0 });
    }
    try {
      const result = await relay.callTool(session.device, session.root, "tasks_clear_finished", {}, { session: session.id, timeoutMs: 10_000 });
      if (result.output.includes("unknown tool")) {
        return c.json({ error: { message: "This device runs an older agent that cannot clear finished tasks. Update the agent on it." } }, 501);
      }
      if (!result.ok) {
        return c.json({ error: { message: result.output } }, 502);
      }
      return c.json({ cleared: Number(/cleared (\d+)/.exec(result.output)?.[1] ?? 0) });
    } catch {
      return c.json({ cleared: 0 });
    }
  });

  // What to tell the person when the device refuses to read or save an instruction file.
  const instructionProblem = (output: string, action: "read" | "change"): { status: 403 | 501 | 502; message: string } => {
    if (output.includes("unknown tool")) {
      return { status: 501, message: "This device runs an older agent that cannot read or save instruction files. Update the agent on it." };
    }
    // A read-only folder says so itself, with its name.
    if (output.includes("is read-only on this device")) {
      return { status: 403, message: output };
    }
    if (output.includes("is not allowed on this device")) {
      return { status: 403, message: `This device does not let the agent ${action} files, so this cannot be done from here.` };
    }
    return { status: 502, message: output };
  };

  // How long a device has to read or save an instruction file.
  const INSTRUCTION_TIMEOUT_MS = 10_000;

  // The session and the file a request for one instruction file names, or the reply to give instead. Only the two names, and only for a
  // conversation that has a project folder; the device checks both again.
  const instructionTarget = (c: Context): { session: NonNullable<ReturnType<Sessions["get"]>>; name: InstructionName } | { reply: Response } => {
    const session = sessions.get(c.req.param("id") ?? "");
    if (!session) {
      return { reply: c.json({ error: { message: "no such session" } }, 404) };
    }
    const name = INSTRUCTION_NAMES.find((n) => {
      return n === c.req.param("name");
    });
    if (!name) {
      return { reply: c.json({ error: { message: `only ${INSTRUCTION_NAMES.join(" and ")} can be read or changed here` } }, 404) };
    }
    if (session.device === "") {
      return { reply: c.json({ error: { message: "this conversation has no project folder" } }, 409) };
    }
    return { session, name };
  };

  // Asks the session's device to read or save a file. Gives what it answered, or the reply to give when it could not be reached or refused.
  const askInstruction = async (c: Context, session: NonNullable<ReturnType<Sessions["get"]>>, tool: "read_instruction" | "write_instruction", args: Record<string, unknown>, unreachable: string): Promise<{ output: string } | { reply: Response }> => {
    let result: Awaited<ReturnType<typeof relay.callTool>>;
    try {
      result = await relay.callTool(session.device, session.root, tool, args, { session: session.id, timeoutMs: INSTRUCTION_TIMEOUT_MS });
    } catch (err) {
      return { reply: c.json({ error: { message: `${unreachable}: ${err instanceof Error ? err.message : String(err)}` } }, 503) };
    }
    if (!result.ok) {
      const problem = instructionProblem(result.output, tool === "read_instruction" ? "read" : "change");
      return { reply: c.json({ error: { message: problem.message } }, problem.status) };
    }
    return { output: result.output };
  };

  // The project's instruction files (AGENTS.md and CLAUDE.md) as the session's device has them, for the person to read and change from the
  // page. Only those two names, only in the session's own project folder, and the device checks both again. A conversation with no
  // project folder has none. What a file says is never written to the log.
  app.get("/sessions/:id/instructions", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    if (session.device === "") {
      return c.json([]);
    }
    try {
      return c.json(await Promise.all(INSTRUCTION_NAMES.map(async (name) => {
        const result = await relay.callTool(session.device, session.root, "read_instruction", { name }, { session: session.id, timeoutMs: INSTRUCTION_TIMEOUT_MS });
        if (!result.ok) {
          // A file that cannot be opened here (too long, not text, or the device will not say) is listed with why, and no length.
          return { name, note: instructionProblem(result.output, "read").message };
        }
        const file = JSON.parse(result.output) as { exists: boolean; text: string };
        return { name, exists: file.exists, length: file.text.length };
      })));
    } catch (err) {
      return c.json({ error: { message: `Could not reach the device: ${err instanceof Error ? err.message : String(err)}` } }, 503);
    }
  });

  app.get("/sessions/:id/instructions/:name", async (c) => {
    const target = instructionTarget(c);
    if ("reply" in target) {
      return target.reply;
    }
    const answer = await askInstruction(c, target.session, "read_instruction", { name: target.name }, "Could not reach the device");
    if ("reply" in answer) {
      return answer.reply;
    }
    return c.json(JSON.parse(answer.output) as unknown);
  });

  // Save a file, if it is still at the version the page opened. A file that changed since is refused with 409, and its current version, so
  // the page can show what happened and offer to reload. A save is the person's own act, so it asks for no approval.
  app.put("/sessions/:id/instructions/:name", async (c) => {
    const target = instructionTarget(c);
    if ("reply" in target) {
      return target.reply;
    }
    const parsed = InstructionSave.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    const answer = await askInstruction(c, target.session, "write_instruction", { name: target.name, text: parsed.data.text, version: parsed.data.version }, "Could not reach the device, so nothing was saved");
    if ("reply" in answer) {
      return answer.reply;
    }
    const saved = JSON.parse(answer.output) as { saved: boolean; message?: string; version: string; length?: number };
    if (!saved.saved) {
      return c.json({ error: { message: saved.message ?? "The file changed on the device after you opened it." }, conflict: true, version: saved.version }, 409);
    }
    return c.json({ saved: true, version: saved.version, length: saved.length });
  });

  // Take the steps that are done off the plan. The model is told, and a reload shows the cleared plan.
  app.delete("/sessions/:id/plan/done", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const result = session.clearDonePlan();
    if (!result.ok) {
      return c.json({ error: { message: result.reason } }, 409);
    }
    return c.json({ cleared: result.cleared });
  });

  app.delete("/sessions/:id", async (c) => {
    // Whatever the session left running on its device stops with it, as far as the device can be reached.
    const doomed = sessions.get(c.req.param("id"));
    if (doomed && doomed.device !== "") {
      await relay.callTool(doomed.device, doomed.root, "tasks_stop_all", {}, { session: doomed.id, timeoutMs: 10_000 }).catch(() => {
        return undefined;
      });
    }
    if (!(await sessions.delete(c.req.param("id")))) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/cancel", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    session.cancel();
    return c.json({ ok: true });
  });

  // Server-sent events: everything so far from `from`, then live. fetch-based, so the key can go in a header.
  app.get("/sessions/:id/events", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const from = Math.max(0, Number(c.req.query("from")) || 0);
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const frame = (text: string): Uint8Array => {
          return encoder.encode(text + String.fromCharCode(10, 10));
        };
        unsubscribe = session.subscribe((event) => {
          controller.enqueue(frame(`data: ${JSON.stringify(event)}`));
        }, from);
        keepalive = setInterval(() => {
          controller.enqueue(frame(": keepalive"));
        }, 15_000);
      },
      cancel() {
        unsubscribe?.();
        clearInterval(keepalive);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  });

  // Which connected device the browser is on, by the address it connects from: used to offer "new code session here". An empty list
  // means no match, and the page asks the person instead.
  app.get("/whoami", (c) => {
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    const address = callerAddress(env?.incoming?.socket?.remoteAddress, c.req.header("x-forwarded-for"), trustProxy);
    // Behind a container's port publishing every browser (and every device) shows as the container network's gateway, so a match would
    // be a coincidence of the NAT: say nothing, and let the person choose.
    const hidden = onOwnContainerNetwork(address, interfaces());
    const devices = hidden
      ? []
      : registry.live().filter((n) => {
          return n.kind === "local" && address !== undefined && n.address === address;
        }).map((n) => {
          return n.nodeId;
        });
    return c.json({ address, devices, likelyBehindPortPublishing: hidden || (devices.length === 0 && looksLikeContainerNetwork(address)) });
  });

  // The gateway's skill library: list, add (a zip or the files of a folder), export as a zip, remove.
  app.get("/library/skills", async (c) => {
    return c.json(library ? await library.list() : []);
  });

  app.post("/library/skills", async (c) => {
    const parsed = LibraryImport.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!library) {
      return c.json({ error: { message: "this gateway has no skill library" } }, 404);
    }
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      const options = { overwrite: parsed.data.overwrite };
      const skill = parsed.data.zip !== undefined
        ? await library.addZip(new Uint8Array(Buffer.from(parsed.data.zip, "base64")), options)
        : await library.add(new Map((parsed.data.files ?? []).map((f) => {
            return [f.path, new Uint8Array(Buffer.from(f.data, "base64"))] as const;
          })), options);
      return c.json(skill, 201);
    } catch (err) {
      if (err instanceof LibraryError) {
        return c.json({ error: { message: err.message } }, err instanceof LibraryConflict ? 409 : 422);
      }
      throw err;
    }
  });

  app.get("/library/skills/:name/export", async (c) => {
    try {
      const zip = await library?.exportZip(c.req.param("name"));
      if (!zip) {
        return c.json({ error: { message: "this gateway has no skill library" } }, 404);
      }
      return c.body(zip.slice().buffer, 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${c.req.param("name").replace(/[^\w-]+/g, "")}.zip"` });
    } catch (err) {
      return c.json({ error: { message: err instanceof Error ? err.message : String(err) } }, 404);
    }
  });

  app.delete("/library/skills/:name", async (c) => {
    if (!(await library?.remove(c.req.param("name")))) {
      return c.json({ error: { message: "no such skill in the library" } }, 404);
    }
    return c.json({ ok: true });
  });

  // The skills and instruction files each device finds in each project folder it exposes, for the composer's slash menu and the skills
  // page. `device` and `root` narrow it to one folder. A device that cannot answer (an older one) is listed with no skills.
  app.get("/skills", async (c) => {
    const only = { device: c.req.query("device"), root: c.req.query("root") };
    const folders = registry.live().filter((n) => {
      return n.kind === "local" && (only.device === undefined || n.nodeId === only.device);
    }).flatMap((n) => {
      return (n.roots ?? []).filter((r) => {
        return only.root === undefined || r === only.root;
      }).map((root) => {
        return { device: n.nodeId, root };
      });
    });
    return c.json(await Promise.all(folders.map(async ({ device, root }) => {
      try {
        const result = await relay.callTool(device, root, "project_context", {}, { timeoutMs: 15_000 });
        const context = result.ok ? JSON.parse(result.output) as ProjectContext : undefined;
        if (context) {
          return { device, root, skills: context.skills, skipped: context.skipped, instructions: context.instructions.map((i) => {
            return { source: i.source, length: i.text.length };
          }) };
        }
        return { device, root, skills: [], skipped: [], instructions: [], note: result.output };
      } catch (err) {
        return { device, root, skills: [], skipped: [], instructions: [], note: err instanceof Error ? err.message : String(err) };
      }
    })));
  });

  // Everything that can be chosen, for the interface: each model on each device with what choosing it would do, and Claude.
  app.get("/catalogue", (c) => {
    const nodes = registry.live();
    const claudeDevice = nodes.find((n) => {
      return n.claude;
    });
    // While Claude is at its limit its models are listed with when they come back, so the page can show why they are greyed out.
    const limitedUntil = claudeDevice ? claude.limitedUntil() : undefined;
    return c.json({
      models: catalogue(nodes),
      claude: { available: claudeDevice !== undefined && limitedUntil === undefined, device: claudeDevice?.nodeId, models: claudeDevice ? CLAUDE_MODEL_IDS : [], limitedUntil, model: claude.reportedModel() },
    });
  });

  // How much of the Claude plan is left, as the claude program last reported it.
  app.get("/claude/usage", (c) => {
    return c.json(claude.status());
  });

  app.get("/v1/models", (c) => {
    const local = registry
      .live()
      .flatMap((n) => {
        return n.models.filter((m) => {
          return m.loaded;
        }).map((m) => {
          return { id: m.id, object: "model", owned_by: n.nodeId };
        });
      });
    // Claude is offered only while a device that is logged in to it is connected.
    const claudeDevice = registry.live().find((n) => {
      return n.claude;
    });
    const claudeModels = claudeDevice && claude.limitedUntil() === undefined
      ? CLAUDE_MODEL_IDS.map((id) => {
          return { id, object: "model", owned_by: claudeDevice.nodeId };
        })
      : [];
    return c.json({ object: "list", data: [...local, ...claudeModels] });
  });

  app.post("/v1/chat/completions", async (c) => {
    const parsed = ChatRequest.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    const req = parsed.data;

    if (isClaudeModel(req.model)) {
      if (!registry.live().some((n) => {
        return n.claude;
      })) {
        return c.json({ error: { message: "no connected device is logged in to Claude. Turn Claude on for a device where `claude` is logged in (Devices page, or CLAUDE_ENABLED=1)" } }, 503);
      }
      try {
        const { result, device } = await askClaude({ registry, relay, state: claude }, req.model, req.messages, { body: JSON.stringify(req) });
        if (req.stream) {
          return new Response(toSse(result), { headers: { "content-type": "text/event-stream", "x-harness-node": device } });
        }
        return c.json(toOpenAIResponse(result), 200, { "x-harness-node": device });
      } catch (err) {
        // A limit is not a fault of the gateway: say when it ends, and let clients back off until then.
        if (err instanceof ClaudeUnavailableError) {
          return c.json({ error: { message: err.message } }, 429, { "retry-after": String(Math.max(1, Math.ceil((err.until - Date.now()) / 1000))) });
        }
        return c.json({ error: { message: (err as Error).message } }, 502);
      }
    }

    let route;
    try {
      route = await resolveRoute({ registry, loader }, req);
    } catch (err) {
      if (err instanceof RouteError) {
        return c.json({ error: { message: err.message } }, err.status);
      }
      throw err;
    }

    let upstream: Response;
    try {
      upstream = await relay.request(route.node.nodeId, JSON.stringify({ ...req, model: route.model }));
    } catch (err) {
      return c.json({ error: { message: `node ${route.node.nodeId} is unreachable: ${(err as Error).message}` } }, 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "x-harness-node": route.node.nodeId,
      },
    });
  });

  return app;
};
