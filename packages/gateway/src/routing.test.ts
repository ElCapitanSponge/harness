import type { ChatRequest, Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelLoader } from "./loader.js";
import { Registry } from "./registry.js";
import { catalogue, explainNoRoute, pickLoadable } from "./router.js";
import { RouteError, resolveRoute } from "./routing.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => {
  return {
    nodeId: "pc",
    kind: "local",
    busy: false,
    modelControl: true,
    models: [
      { id: "loaded-model", loaded: true, contextLength: 8192 },
      { id: "idle-model", loaded: false, contextLength: 16_384 },
    ],
    ...over,
  };
};

const req = (model: string): ChatRequest => {
  return { model, messages: [{ role: "user", content: "hi" }] };
};

let registry: Registry;
const ensure = vi.fn<ModelLoader["ensure"]>();

beforeEach(() => {
  registry = new Registry();
  registry.upsert(beat());
  ensure.mockReset();
  ensure.mockResolvedValue(undefined);
});

describe("pickLoadable", () => {
  it("finds an idle device that has the model unloaded and may load it, and what is loaded there now", () => {
    const found = pickLoadable(registry.live(), req("idle-model"));
    expect(found).toMatchObject({ model: "idle-model", maxContext: 16_384, loadedOthers: ["loaded-model"] });
    expect(found?.node.nodeId).toBe("pc");
  });

  it("never loads for auto, and skips busy devices, devices that do not allow loading, and loaded models", () => {
    expect(pickLoadable(registry.live(), req("auto"))).toBeUndefined();
    expect(pickLoadable(registry.live(), req("loaded-model"))).toBeUndefined();
    registry.upsert(beat({ busy: true }));
    expect(pickLoadable(registry.live(), req("idle-model"))).toBeUndefined();
    registry.upsert(beat({ modelControl: false }));
    expect(pickLoadable(registry.live(), req("idle-model"))).toBeUndefined();
  });
});

describe("explainNoRoute", () => {
  it("says what is wrong in terms the person can act on", () => {
    expect(explainNoRoute([], req("x"))).toBe("no device is connected");
    expect(explainNoRoute(registry.live(), req("auto"))).toContain("pick a model by name");
    expect(explainNoRoute(registry.live(), req("nope"))).toBe("no connected device has a model named \"nope\"");

    registry.upsert(beat({ busy: true, busyReason: "game running: cs2.exe" }));
    expect(explainNoRoute(registry.live(), req("idle-model"))).toBe("pc has \"idle-model\" but is busy (game running: cs2.exe)");

    registry.upsert(beat({ modelControl: false }));
    expect(explainNoRoute(registry.live(), req("idle-model"))).toContain("ALLOW_MODEL_CONTROL=1");
  });
});

describe("catalogue", () => {
  it("lists every model with what choosing it would do", () => {
    registry.upsert(beat({ nodeId: "mac", modelControl: false, models: [{ id: "mac-model", loaded: false }] }));
    registry.upsert(beat({ nodeId: "busy", busy: true, busyReason: "gaming", models: [{ id: "busy-model", loaded: true }] }));
    const entries = catalogue(registry.live());
    const byId = Object.fromEntries(
      entries.map((e) => {
        return [e.id, e.state];
      }),
    );
    expect(byId).toEqual({
      "loaded-model": "loaded",
      "idle-model": "loads-on-use",
      "mac-model": "cannot-load",
      "busy-model": "busy",
    });
    expect(entries.find((e) => {
      return e.id === "busy-model";
    })?.busyReason).toBe("gaming");
  });

  it("leaves out devices that only serve Claude", () => {
    registry.upsert({ nodeId: "claude-box", kind: "claude", busy: false, models: [{ id: "x", loaded: true }] });
    expect(catalogue(registry.live()).some((e) => {
      return e.device === "claude-box";
    })).toBe(false);
  });
});

describe("resolveRoute", () => {
  it("uses a loaded model without loading anything", async () => {
    const route = await resolveRoute({ registry, loader: { ensure } }, req("loaded-model"));
    expect(route.model).toBe("loaded-model");
    expect(ensure).not.toHaveBeenCalled();
  });

  it("loads an available model first and then routes to it", async () => {
    const route = await resolveRoute({ registry, loader: { ensure } }, req("idle-model"));
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(route).toMatchObject({ model: "idle-model" });
    expect(route.node.nodeId).toBe("pc");
  });

  it("passes progress stages through", async () => {
    ensure.mockImplementation((_t, onStage) => {
      onStage?.({ type: "loading", model: "idle-model", contextLength: 16_384 });
      return Promise.resolve();
    });
    const stages: string[] = [];
    await resolveRoute({ registry, loader: { ensure } }, req("idle-model"), (s) => {
      stages.push(s.type);
    });
    expect(stages).toEqual(["loading"]);
  });

  it("answers 503 with the reason when nothing can serve the request", async () => {
    registry.upsert(beat({ modelControl: false }));
    const error = await resolveRoute({ registry, loader: { ensure } }, req("idle-model")).catch((e: unknown) => {
      return e;
    });
    expect(error).toBeInstanceOf(RouteError);
    expect((error as RouteError).status).toBe(503);
    expect((error as RouteError).message).toContain("ALLOW_MODEL_CONTROL=1");
    expect(ensure).not.toHaveBeenCalled();
  });

  it("answers 502 with the device's reason when the load fails", async () => {
    ensure.mockRejectedValue(new Error("pc could not load idle-model: not enough memory"));
    const error = await resolveRoute({ registry, loader: { ensure } }, req("idle-model")).catch((e: unknown) => {
      return e;
    });
    expect((error as RouteError).status).toBe(502);
    expect((error as RouteError).message).toBe("pc could not load idle-model: not enough memory");
  });
});
