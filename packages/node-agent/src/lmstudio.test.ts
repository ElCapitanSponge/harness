import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels } from "./lmstudio.js";

const mockFetch = (body: unknown, ok = true, status = 200) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status, json: async () => body }));

afterEach(() => vi.unstubAllGlobals());

describe("listModels", () => {
  it("maps loaded state and prefers the loaded context length", async () => {
    mockFetch({
      data: [
        { id: "a", type: "llm", state: "loaded", loaded_context_length: 16384, max_context_length: 131072 },
        { id: "b", type: "llm", state: "not-loaded", max_context_length: 8192 },
      ],
    });
    expect(await listModels("http://x")).toEqual([
      { id: "a", loaded: true, contextLength: 16384 },
      { id: "b", loaded: false, contextLength: 8192 },
    ]);
  });

  it("filters out embedding models", async () => {
    mockFetch({ data: [{ id: "emb", type: "embeddings", state: "not-loaded" }, { id: "llm", type: "llm", state: "loaded" }] });
    expect((await listModels("http://x")).map((m) => m.id)).toEqual(["llm"]);
  });

  it("throws when LM Studio returns an error status", async () => {
    mockFetch({}, false, 500);
    await expect(listModels("http://x")).rejects.toThrow("500");
  });
});
