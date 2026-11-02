import type { NodeRecord } from "@harness/core";
import { describe, expect, it } from "vitest";
import { chooseModel, parseList, type AutoInput } from "./auto.js";

const node = (nodeId: string, over: Partial<NodeRecord> = {}): NodeRecord => {
  return { nodeId, kind: "local", busy: false, models: [], modelControl: true, lastSeen: 0, ...over };
};

const input = (over: Partial<AutoInput> = {}): AutoInput => {
  return {
    tokens: 2000,
    needsTools: false,
    nodes: [
      node("anakin", { models: [{ id: "qwen3-coder-30b", loaded: true, contextLength: 32_768 }, { id: "gemma-3-12b", loaded: false, contextLength: 131_072 }, { id: "tiny-1b", loaded: true, contextLength: 4096 }] }),
    ],
    claude: { available: false },
    prefs: { prefer: [], avoid: [], keepFree: [] },
    ...over,
  };
};

const chosen = (result: ReturnType<typeof chooseModel>) => {
  if (!("chosen" in result)) {
    throw new Error(`nothing chosen: ${result.none}`);
  }
  return result.chosen;
};

describe("Auto: what fits", () => {
  it("never chooses a model that cannot hold the conversation plus a reply, and says what it chose and why", () => {
    // 3000 tokens needs about 4.6k: the 4k model is out, and a chat takes the smaller of what is left that is already loaded.
    const c = chosen(chooseModel(input({ tokens: 3000 })));
    expect(c).toMatchObject({ model: "qwen3-coder-30b", device: "anakin", loads: false });
    expect(c.reason).toBe("qwen3-coder-30b: loaded on anakin, fits 3k tokens");
  });

  it("takes the smallest loaded model that fits for a short chat", () => {
    expect(chosen(chooseModel(input({ tokens: 200 }))).model).toBe("tiny-1b");
  });

  it("takes a larger window for a coding session, and nothing under 8k tokens", () => {
    const c = chosen(chooseModel(input({ needsTools: true, tokens: 200 })));
    expect(c.model).toBe("qwen3-coder-30b");
    expect(c.reason).toContain("has room to work");
  });

  it("loads a model that is not loaded when it is the only one that fits, if the device allows it", () => {
    const nodes = [node("anakin", { models: [{ id: "tiny-1b", loaded: true, contextLength: 4096 }, { id: "gemma-3-12b", loaded: false, contextLength: 131_072 }] })];
    const c = chosen(chooseModel(input({ tokens: 10_000, nodes })));
    expect(c).toMatchObject({ model: "gemma-3-12b", loads: true });
    expect(c.reason).toBe("gemma-3-12b: loads on anakin, fits 10k tokens");
    // An unloaded model gets the loader's default window (32k), however large it can go, so 40k does not fit it.
    expect(chooseModel(input({ tokens: 40_000, nodes }))).toMatchObject({ none: expect.stringContaining("the largest holds 33k") as string });
  });
});

describe("Auto: what is available", () => {
  it("prefers a loaded model to one that has to be loaded", () => {
    const nodes = [node("anakin", { models: [{ id: "small-loaded", loaded: true, contextLength: 16_384 }, { id: "small-unloaded", loaded: false, contextLength: 16_384 }] })];
    expect(chosen(chooseModel(input({ nodes }))).model).toBe("small-loaded");
  });

  it("does not choose on a device that is busy, that must stay free, or that will not load models", () => {
    const nodes = [
      node("gaming", { busy: true, busyReason: "RocketLeague.exe", models: [{ id: "a", loaded: true, contextLength: 32_768 }] }),
      node("reserved", { models: [{ id: "b", loaded: true, contextLength: 32_768 }] }),
      node("locked", { modelControl: false, models: [{ id: "c", loaded: false, contextLength: 32_768 }, { id: "d", loaded: true, contextLength: 32_768 }] }),
    ];
    const c = chosen(chooseModel(input({ nodes, prefs: { prefer: [], avoid: [], keepFree: ["reserved"] } })));
    expect(c).toMatchObject({ model: "d", device: "locked" });
  });

  it("leaves out an embedding model, which cannot answer", () => {
    const nodes = [node("anakin", { models: [{ id: "nomic-embed-text", loaded: true, contextLength: 8192 }, { id: "llama", loaded: true, contextLength: 8192 }] })];
    expect(chosen(chooseModel(input({ nodes }))).model).toBe("llama");
  });
});

describe("Auto: Claude", () => {
  const claude = { available: true, device: "bastila" };

  it("is used when no local model is ready, or none has room, and never when it is limited", () => {
    const nobody = chooseModel(input({ nodes: [], claude }));
    expect(chosen(nobody)).toMatchObject({ model: "claude", device: "bastila" });
    expect(chosen(nobody).reason).toBe("Claude: no local model is ready");

    const crowded = chosen(chooseModel(input({ tokens: 90_000, claude })));
    expect(crowded.model).toBe("claude");
    expect(crowded.reason).toContain("no local model has room for 90k tokens");

    const limited = chooseModel(input({ nodes: [], claude: { available: false, limitedUntil: Date.now() + 3_600_000 } }));
    expect(limited).toMatchObject({ none: expect.stringContaining("claude is limited until") as string });
  });

  it("is used when the conversation is close to what the best local model holds, and not for an ordinary turn", () => {
    expect(chosen(chooseModel(input({ tokens: 1000, claude, nodes: [node("anakin", { models: [{ id: "m", loaded: true, contextLength: 32_768 }] })] }))).model).toBe("m");
    const crowded = chosen(chooseModel(input({ tokens: 26_000, claude, nodes: [node("anakin", { models: [{ id: "m", loaded: true, contextLength: 32_768 }] })] })));
    expect(crowded.model).toBe("claude");
    expect(crowded.reason).toContain("close to what m holds");
  });
});

describe("Auto: the owner's preferences", () => {
  const nodes = [node("anakin", { models: [{ id: "qwen3-coder-30b", loaded: true, contextLength: 32_768 }, { id: "gemma-3-12b", loaded: false, contextLength: 32_768 }] })];

  it("puts the first listed model first, even if it has to be loaded", () => {
    const c = chosen(chooseModel(input({ nodes, prefs: { prefer: ["gemma", "qwen"], avoid: [], keepFree: [] } })));
    expect(c).toMatchObject({ model: "gemma-3-12b", loads: true });
    expect(c.reason).toContain("your first choice");
  });

  it("never chooses a model it was told to avoid", () => {
    const c = chosen(chooseModel(input({ nodes, prefs: { prefer: [], avoid: ["qwen"], keepFree: [] } })));
    expect(c.model).toBe("gemma-3-12b");
  });

  it("can put Claude first", () => {
    const c = chosen(chooseModel(input({ nodes, claude: { available: true, device: "bastila" }, prefs: { prefer: ["claude"], avoid: [], keepFree: [] } })));
    expect(c).toMatchObject({ model: "claude", reason: "Claude: you put Claude first" });
  });

  it("reads a list setting into names", () => {
    expect(parseList(" qwen, ,gemma ")).toEqual(["qwen", "gemma"]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("Auto: staying put", () => {
  it("stays on the model that answered last while it still fits, even if another would rank higher", () => {
    const c = chosen(chooseModel(input({ tokens: 200, current: "qwen3-coder-30b" })));
    expect(c.model).toBe("qwen3-coder-30b");
    expect(c.reason).toBe("staying on qwen3-coder-30b: it still fits 200 tokens");
  });

  it("moves when the last model no longer fits", () => {
    const nodes = [node("anakin", { models: [{ id: "small", loaded: true, contextLength: 4096 }, { id: "big", loaded: true, contextLength: 65_536 }] })];
    expect(chosen(chooseModel(input({ nodes, tokens: 20_000, current: "small" }))).model).toBe("big");
  });
});

describe("Auto: when nothing can be chosen", () => {
  it("says why in words that can be acted on", () => {
    expect(chooseModel(input({ nodes: [] }))).toMatchObject({ none: expect.stringContaining("no device is connected, and claude is not available") as string });
    const busy = chooseModel(input({ nodes: [node("pc", { busy: true, models: [{ id: "a", loaded: true }] })] }));
    expect(busy).toMatchObject({ none: expect.stringContaining("every device is busy (pc)") as string });
    const small = chooseModel(input({ needsTools: true, nodes: [node("pc", { models: [{ id: "tiny", loaded: true, contextLength: 4096 }] })] }));
    expect(small).toMatchObject({ none: expect.stringContaining("too small for a coding session") as string });
    expect(chooseModel(input({ tokens: 500_000 }))).toMatchObject({ none: expect.stringContaining("compact the conversation") as string });
  });
});

describe("Auto: images", () => {
  const nodes = [node("anakin", { models: [{ id: "qwen3-coder-30b", loaded: true, contextLength: 32_768 }, { id: "qwen2.5-vl-7b", loaded: false, contextLength: 32_768 }] })];

  it("takes only a model that can read images when the message has one, even if it has to be loaded", () => {
    const c = chosen(chooseModel(input({ nodes, needsImages: true })));
    expect(c).toMatchObject({ model: "qwen2.5-vl-7b", loads: true });
  });

  it("does not hand an image to Claude, which is driven with text only (the session then answers without the image)", () => {
    expect(chooseModel(input({ nodes: [], claude: { available: true, device: "bastila" }, needsImages: true }))).toHaveProperty("none");
    expect(chosen(chooseModel(input({ nodes: [], claude: { available: true, device: "bastila" } }))).model).toBe("claude");
  });
});
