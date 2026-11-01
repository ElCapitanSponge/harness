import type { TunnelMessage } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createChatServer } from "./chat.js";
import { createIdleUnloader } from "./idle.js";
import { createModelServer } from "./models.js";

const MIN = 60_000;

const setup = (over: { minutes?: number; enabled?: boolean } = {}) => {
  let clock = 1_000_000;
  const unload = vi.fn<(model: string) => Promise<string>>(() => {
    return Promise.resolve("ok");
  });
  const log = vi.fn();
  const audit = vi.fn();
  const idle = createIdleUnloader({
    minutes: () => {
      return over.minutes ?? 20;
    },
    enabled: () => {
      return over.enabled ?? true;
    },
    unload,
    now: () => {
      return clock;
    },
    log,
    audit,
  });
  return {
    idle,
    unload,
    log,
    audit,
    advance: (minutes: number) => {
      clock += minutes * MIN;
    },
  };
};

describe("unloading a model nobody has used", () => {
  it("unloads it once it has been idle for the limit, and not before", async () => {
    const { idle, unload, advance } = setup();
    idle.start("qwen");
    idle.end("qwen");
    advance(19);
    expect(await idle.check()).toEqual([]);
    advance(2);
    expect(await idle.check()).toEqual(["qwen"]);
    expect(unload).toHaveBeenCalledWith("qwen");
    // It is no longer watched, so it is not unloaded twice.
    advance(60);
    expect(await idle.check()).toEqual([]);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("counts from the last use, so a model in regular use is never unloaded", async () => {
    const { idle, unload, advance } = setup();
    for (let i = 0; i < 6; i++) {
      idle.start("qwen");
      advance(5);
      idle.end("qwen");
    }
    expect(await idle.check()).toEqual([]);
    expect(unload).not.toHaveBeenCalled();
  });

  it("never unloads a model while a reply from it is still being written, however long it takes", async () => {
    const { idle, unload, advance } = setup();
    idle.start("qwen");
    advance(60);
    expect(await idle.check()).toEqual([]);
    idle.end("qwen");
    // Finishing is a use: the clock starts from the end of the reply.
    advance(10);
    expect(await idle.check()).toEqual([]);
    advance(11);
    expect(await idle.check()).toEqual(["qwen"]);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("starts the clock when the gateway loads a model, and handles each model on its own clock", async () => {
    const { idle, unload, advance } = setup();
    idle.touch("a");
    advance(15);
    idle.touch("b");
    advance(6);
    expect(await idle.check()).toEqual(["a"]);
    advance(15);
    expect(await idle.check()).toEqual(["b"]);
    expect(unload.mock.calls.map((c) => {
      return c[0];
    })).toEqual(["a", "b"]);
  });

  it("leaves a model alone that Torii never used", async () => {
    const { idle, unload, advance } = setup();
    advance(600);
    expect(await idle.check()).toEqual([]);
    expect(unload).not.toHaveBeenCalled();
  });

  it("does nothing when the limit is zero or the device does not allow model control", async () => {
    for (const over of [{ minutes: 0 }, { enabled: false }]) {
      const { idle, unload, advance } = setup(over);
      idle.touch("qwen");
      advance(600);
      expect(await idle.check()).toEqual([]);
      expect(unload).not.toHaveBeenCalled();
    }
  });

  it("writes what it did to the audit log, and stops watching a model it cannot unload", async () => {
    const { idle, unload, audit, log, advance } = setup();
    idle.touch("qwen");
    advance(21);
    await idle.check();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tool: "idle-unload", outcome: "ok", summary: "unloaded qwen after 20 minutes without use" }));

    unload.mockRejectedValueOnce(new Error("no such model"));
    idle.touch("gone");
    advance(21);
    expect(await idle.check()).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not unload gone"));
    expect(idle.tracked()).toEqual([]);
  });
});

describe("what the agent reports to it", () => {
  it("counts a chat request as use while it runs and when it ends, by the model named in it", async () => {
    const { idle, advance } = setup();
    let finish!: () => void;
    const fetchImpl = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        finish = () => {
          resolve(new Response("{}", { headers: { "content-type": "application/json" } }));
        };
      });
    });
    const sent: TunnelMessage[] = [];
    createChatServer({ inferenceUrl: "http://x", fetchImpl: fetchImpl, activity: idle }).handle({ type: "request", id: "1", body: JSON.stringify({ model: "qwen", messages: [] }) }, (m) => {
      sent.push(m);
    });
    expect(idle.tracked()).toMatchObject([{ model: "qwen", inflight: 1 }]);
    advance(60);
    expect(await idle.check()).toEqual([]);
    finish();
    await vi.waitFor(() => {
      expect(idle.tracked()).toMatchObject([{ model: "qwen", inflight: 0 }]);
    });
  });

  it("ignores a request with no model in it", () => {
    const { idle } = setup();
    createChatServer({ inferenceUrl: "http://x", fetchImpl: vi.fn(() => {
      return Promise.resolve(new Response("{}"));
    }), activity: idle }).handle({ type: "request", id: "1", body: "not json" }, () => {
      return undefined;
    });
    expect(idle.tracked()).toEqual([]);
  });

  it("starts the clock when the gateway loads a model and stops watching one it unloads", async () => {
    const { idle } = setup();
    const lms = { serverStart: vi.fn(() => {
      return Promise.resolve("");
    }), load: vi.fn(() => {
      return Promise.resolve("loaded");
    }), unload: vi.fn(() => {
      return Promise.resolve("unloaded");
    }) };
    const server = createModelServer({
      enabled: true,
      isBusy: () => {
        return Promise.resolve(false);
      },
      lms,
      onLoaded: (m) => {
        idle.touch(m);
      },
      onUnloaded: (m) => {
        if (m) {
          idle.forget(m);
        }
      },
    });
    const send = vi.fn();
    await server.handle({ type: "model", id: "1", op: "load", model: "qwen" }, send);
    expect(idle.tracked().map((t) => {
      return t.model;
    })).toEqual(["qwen"]);
    await server.handle({ type: "model", id: "2", op: "unload", model: "qwen" }, send);
    expect(idle.tracked()).toEqual([]);
  });
});
