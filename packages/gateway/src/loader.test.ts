import type { Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ModelLoader } from "./loader.js";
import { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { pickLoadable } from "./router.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => {
  return {
    nodeId: "pc",
    kind: "local",
    busy: false,
    modelControl: true,
    models: [
      { id: "small", loaded: true, contextLength: 8192 },
      { id: "big", loaded: false, contextLength: 262_144 },
      { id: "other", loaded: false, contextLength: 4096 },
    ],
    ...over,
  };
};

let registry: Registry;
let callModel: Mock<Relay["callModel"]>;

const target = (model: string) => {
  const loadable = pickLoadable(registry.live(), { model, messages: [{ role: "user", content: "x" }] });
  if (!loadable) {
    throw new Error(`${model} is not loadable in this test`);
  }
  return loadable;
};

const ops = (): string[] => {
  return callModel.mock.calls.map(([, op, model, ctx]) => {
    return `${op}:${model}${ctx ? `@${ctx}` : ""}`;
  });
};

beforeEach(() => {
  registry = new Registry();
  registry.upsert(beat());
  callModel = vi.fn<Relay["callModel"]>(() => {
    return Promise.resolve({ ok: true, output: "done" });
  });
});

const loader = (over: Partial<ConstructorParameters<typeof ModelLoader>[0]> = {}) => {
  return new ModelLoader({ registry, relay: { callModel }, ...over });
};

describe("ModelLoader", () => {
  it("unloads the device's other models, then loads the one asked for, with a sensible context length", async () => {
    await loader().ensure(target("big"));
    // The model's own maximum (262144) is far too large to load with, so the default is used instead.
    expect(ops()).toEqual(["unload:small", "load:big@32768"]);
  });

  it("uses the model's maximum when that is smaller than the default", async () => {
    await loader().ensure(target("other"));
    expect(ops()).toEqual(["unload:small", "load:other@4096"]);
  });

  it("keeps the other models when asked to", async () => {
    await loader({ unloadOthers: false }).ensure(target("big"));
    expect(ops()).toEqual(["load:big@32768"]);
  });

  it("honours a different default context length", async () => {
    await loader({ defaultContext: 16_384 }).ensure(target("big"));
    expect(ops()).toEqual(["unload:small", "load:big@16384"]);
  });

  it("records the result at once so the next request does not wait for a heartbeat", async () => {
    await loader().ensure(target("big"));
    const models = registry.live()[0]?.models ?? [];
    expect(models.find((m) => {
      return m.id === "big";
    })?.loaded).toBe(true);
    expect(models.find((m) => {
      return m.id === "small";
    })?.loaded).toBe(false);
  });

  it("does nothing when the model has been loaded in the meantime", async () => {
    const wanted = target("big");
    registry.setLoaded("pc", "big", true);
    await loader().ensure(wanted);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("reports the stages so the person can be told what is happening", async () => {
    const stages: string[] = [];
    await loader().ensure(target("big"), (s) => {
      stages.push(`${s.type}:${s.model}`);
    });
    expect(stages).toEqual(["freeing:small", "loading:big"]);
  });

  it("loads a model once when several requests ask for it at the same time", async () => {
    const l = loader();
    await Promise.all([l.ensure(target("big")), l.ensure(target("big")), l.ensure(target("big"))]);
    expect(ops().filter((o) => {
      return o.startsWith("load:");
    })).toHaveLength(1);
  });

  it("loads one model at a time on a device, so two loads never compete for memory", async () => {
    let active = 0;
    let overlapped = false;
    callModel.mockImplementation(async (_node, op) => {
      if (op === "load") {
        active++;
        overlapped ||= active > 1;
        await new Promise((r) => {
          return setTimeout(r, 15);
        });
        active--;
      }
      return { ok: true, output: "done" };
    });
    const l = loader();
    await Promise.all([l.ensure(target("big")), l.ensure(target("other"))]);
    expect(overlapped).toBe(false);
    expect(ops().filter((o) => {
      return o.startsWith("load:");
    })).toHaveLength(2);
  });

  it("explains a failure to free memory and does not try to load", async () => {
    callModel.mockResolvedValueOnce({ ok: false, output: "busy" });
    await expect(loader().ensure(target("big"))).rejects.toThrow("could not free memory on pc by unloading small: busy");
    expect(ops()).toEqual(["unload:small"]);
  });

  it("explains a failure to load, using the device's own words", async () => {
    callModel.mockResolvedValueOnce({ ok: true, output: "ok" }).mockResolvedValueOnce({ ok: false, output: "not enough memory" });
    await expect(loader().ensure(target("big"))).rejects.toThrow("pc could not load big: not enough memory");
  });

  it("recovers after a failure: the next request tries again", async () => {
    callModel.mockResolvedValueOnce({ ok: true, output: "ok" }).mockResolvedValueOnce({ ok: false, output: "nope" });
    const l = loader();
    await expect(l.ensure(target("big"))).rejects.toThrow("nope");
    await expect(l.ensure(target("big"))).resolves.toBeUndefined();
  });

  it("lets a failure in one load not fail a different load queued behind it", async () => {
    callModel.mockResolvedValueOnce({ ok: false, output: "nope" });
    const l = loader({ unloadOthers: false });
    const first = l.ensure(target("big"));
    const second = l.ensure(target("other"));
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBeUndefined();
  });
});
