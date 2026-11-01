import type { ChatRequest } from "@harness/core";
import type { LoadStage, ModelLoader } from "./loader.js";
import type { Registry } from "./registry.js";
import { explainNoRoute, pickLoadable, pickRoute, type Route } from "./router.js";

// A request that cannot be served, with the status the HTTP API should answer with.
export class RouteError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RouteError";
  }
}

// Finds the device and model for a request. A model that is available but not loaded is loaded first.
export const resolveRoute = async (
  deps: { registry: Registry; loader: Pick<ModelLoader, "ensure"> },
  req: ChatRequest,
  onStage?: (stage: LoadStage) => void,
): Promise<Route> => {
  const nodes = deps.registry.live();
  const loaded = pickRoute(nodes, req);
  if (loaded) {
    return loaded;
  }

  const loadable = pickLoadable(nodes, req);
  if (!loadable) {
    throw new RouteError(explainNoRoute(nodes, req), 503);
  }
  try {
    await deps.loader.ensure(loadable, onStage);
  } catch (err) {
    throw new RouteError(err instanceof Error ? err.message : String(err), 502, { cause: err });
  }
  return { node: loadable.node, model: loadable.model };
};
