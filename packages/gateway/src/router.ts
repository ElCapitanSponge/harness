import type { ChatRequest, NodeRecord } from "@harness/core";

export interface Route {
  node: NodeRecord;
  model: string;
}

// Advertised in /v1/models so chat apps can pick Claude from their model list.
export const CLAUDE_MODEL_IDS = ["claude", "claude:sonnet", "claude:opus", "claude:haiku"];

// Models named "claude" or "claude:<alias>" (e.g. claude:sonnet) go to the Claude backend.
export const isClaudeModel = (model: string): boolean => {
  return model === "claude" || model.startsWith("claude:");
};

// "auto" picks any loaded model on an idle node. Otherwise the model id must match exactly.
// Policy lives here only, so tiering and cost rules can be added later without touching transport.
export const pickRoute = (nodes: NodeRecord[], req: ChatRequest): Route | undefined => {
  const candidates = nodes.filter((n) => {
    return n.kind === "local" && !n.busy;
  });
  for (const node of candidates) {
    const loaded = node.models.filter((m) => {
      return m.loaded;
    });
    const match = req.model === "auto"
      ? loaded[0]
      : loaded.find((m) => {
          return m.id === req.model;
        });
    if (match) {
      return { node, model: match.id };
    }
  }
  return undefined;
};

// A model that is available on an idle device but not loaded, and what loading it would need to know.
export interface Loadable {
  node: NodeRecord;
  model: string;
  // The model's own maximum context length, as the device reports it.
  maxContext?: number;
  // The models that are loaded on that device now, which may have to make room.
  loadedOthers: string[];
}

// Finds a device that has the requested model but has not loaded it, and is allowed to load it and is not busy.
// "auto" never causes a load: it takes whatever is already loaded.
export const pickLoadable = (nodes: NodeRecord[], req: ChatRequest): Loadable | undefined => {
  if (req.model === "auto") {
    return undefined;
  }
  for (const node of nodes) {
    if (node.kind !== "local" || node.busy || !node.modelControl) {
      continue;
    }
    const match = node.models.find((m) => {
      return m.id === req.model && !m.loaded;
    });
    if (match) {
      return {
        node,
        model: match.id,
        maxContext: match.contextLength,
        loadedOthers: node.models.filter((m) => {
          return m.loaded;
        }).map((m) => {
          return m.id;
        }),
      };
    }
  }
  return undefined;
};

// Says why no device can serve a request, in terms the person can act on.
export const explainNoRoute = (nodes: NodeRecord[], req: ChatRequest): string => {
  const local = nodes.filter((n) => {
    return n.kind === "local";
  });
  if (local.length === 0) {
    return "no device is connected";
  }
  if (req.model === "auto") {
    return "no idle device has a model loaded; pick a model by name and it will be loaded";
  }
  const having = local.filter((n) => {
    return n.models.some((m) => {
      return m.id === req.model;
    });
  });
  if (having.length === 0) {
    return `no connected device has a model named "${req.model}"`;
  }
  const busy = having.find((n) => {
    return n.busy;
  });
  if (busy) {
    return `${busy.nodeId} has "${req.model}" but is busy${busy.busyReason ? ` (${busy.busyReason})` : ""}`;
  }
  const locked = having.find((n) => {
    return !n.modelControl;
  });
  if (locked) {
    return `${locked.nodeId} has "${req.model}" but it is not loaded and this device does not let the gateway load models; load it there, or start its agent with ALLOW_MODEL_CONTROL=1`;
  }
  return `no idle device could serve "${req.model}"`;
};

export type CatalogueState = "loaded" | "loads-on-use" | "cannot-load" | "busy";

export interface CatalogueEntry {
  id: string;
  device: string;
  state: CatalogueState;
  contextLength?: number;
  busyReason?: string;
}

// Every model on every connected device, with what choosing it would do: use it now, load it first, or nothing because the
// device is busy or does not let the gateway load models.
export const catalogue = (nodes: NodeRecord[]): CatalogueEntry[] => {
  return nodes
    .filter((n) => {
      return n.kind === "local";
    })
    .flatMap((node) => {
      return node.models.map((m): CatalogueEntry => {
        let state: CatalogueState = "cannot-load";
        if (node.busy) {
          state = "busy";
        } else if (m.loaded) {
          state = "loaded";
        } else if (node.modelControl) {
          state = "loads-on-use";
        }
        return { id: m.id, device: node.nodeId, state, contextLength: m.contextLength, busyReason: node.busy ? node.busyReason : undefined };
      });
    });
};
