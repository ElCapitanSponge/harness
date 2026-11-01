import type { TunnelMessage } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createModelServer } from "./models.js";

const fakeLms = () => {
  return {
    serverStart: vi.fn(async () => {
      return "started";
    }),
    load: vi.fn(async (model: string) => {
      return `loaded ${model}`;
    }),
    unload: vi.fn(async () => {
      return "";
    }),
  };
};

const run = async (opts: { enabled?: boolean; busy?: boolean }, msg: { op: "load" | "unload"; model?: string; contextLength?: number }) => {
  const lms = fakeLms();
  const server = createModelServer({ enabled: opts.enabled ?? true, isBusy: async () => {
    return opts.busy ?? false;
  }, lms });
  const out: TunnelMessage[] = [];
  await server.handle({ type: "model", id: "m1", ...msg }, (m) => {
    return out.push(m);
  });
  expect(out).toHaveLength(1);
  return { lms, reply: out[0] as { type: "tool-result"; id: string; ok: boolean; output: string } };
};

describe("createModelServer", () => {
  it("loads a model with its context length, starting the LM Studio server first", async () => {
    const { lms, reply } = await run({}, { op: "load", model: "qwen3.5-9b", contextLength: 32768 });
    expect(reply).toEqual({ type: "tool-result", id: "m1", ok: true, output: "loaded qwen3.5-9b" });
    expect(lms.serverStart).toHaveBeenCalled();
    expect(lms.load).toHaveBeenCalledWith("qwen3.5-9b", 32768);
  });

  it("unloads one model or all of them", async () => {
    const one = await run({}, { op: "unload", model: "qwen3.5-9b" });
    expect(one.lms.unload).toHaveBeenCalledWith("qwen3.5-9b");
    expect(one.reply.output).toBe("unloaded qwen3.5-9b");

    const all = await run({}, { op: "unload" });
    expect(all.lms.unload).toHaveBeenCalledWith(undefined);
    expect(all.reply.output).toBe("unloaded all models");
  });

  it("refuses everything unless the owner enabled it, without touching LM Studio", async () => {
    const { lms, reply } = await run({ enabled: false }, { op: "load", model: "qwen" });
    expect(reply.ok).toBe(false);
    expect(reply.output).toContain("ALLOW_MODEL_CONTROL=1");
    expect(lms.load).not.toHaveBeenCalled();
    expect(lms.serverStart).not.toHaveBeenCalled();
  });

  it("refuses while the device is busy, so a remote load cannot take the GPU from a game", async () => {
    const { lms, reply } = await run({ busy: true }, { op: "load", model: "qwen" });
    expect(reply).toMatchObject({ ok: false, output: "this device is busy right now" });
    expect(lms.load).not.toHaveBeenCalled();
  });

  it("refuses model ids that could be read as options, and bad context lengths", async () => {
    for (const model of ["--help", "-y", "", "a;b", "x".repeat(300)]) {
      const { lms, reply } = await run({}, { op: "load", model });
      expect(reply.ok, model).toBe(false);
      expect(lms.load).not.toHaveBeenCalled();
    }
    expect((await run({}, { op: "load" })).reply.ok).toBe(false);
    expect((await run({}, { op: "load", model: "qwen", contextLength: 3 })).reply.output).toBe("invalid context length");
    expect((await run({}, { op: "unload", model: "--all" })).reply.ok).toBe(false);
  });

  it("reports an LM Studio failure", async () => {
    const lms = fakeLms();
    lms.load.mockRejectedValue(new Error("model not found"));
    const out: TunnelMessage[] = [];
    await createModelServer({ enabled: true, isBusy: async () => {
      return false;
    }, lms }).handle({ type: "model", id: "m", op: "load", model: "nope" }, (m) => {
      return out.push(m);
    });
    expect(out[0]).toMatchObject({ ok: false, output: "model not found" });
  });
});
