import type { ModelInfo } from "@harness/core";

interface LmStudioModel {
  id: string;
  type?: string;
  state?: string;
  loaded_context_length?: number;
  max_context_length?: number;
}

export const listModels = async (baseUrl: string, sizes: ReadonlyMap<string, number> = new Map()): Promise<ModelInfo[]> => {
  const res = await fetch(`${baseUrl}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`LM Studio returned ${res.status}`);
  }
  const body = (await res.json()) as { data: LmStudioModel[] };
  return body.data
    .filter((m) => {
      return m.type !== "embeddings";
    })
    .map((m) => {
      return {
        id: m.id,
        loaded: m.state === "loaded",
        contextLength: m.loaded_context_length ?? m.max_context_length,
        ...(sizes.has(m.id) ? { sizeBytes: sizes.get(m.id) } : {}),
      };
    });
};
