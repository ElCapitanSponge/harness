import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { Loadable } from "./router.js";

export interface LoaderOptions {
  registry: Registry;
  relay: Pick<Relay, "callModel">;
  // Unload the device's other models first, since two usually do not fit in a graphics card's memory.
  unloadOthers?: boolean;
  // The context length to load with when the person did not choose one. Models report their maximum, which is often far too large.
  defaultContext?: number;
}

export type LoadStage = { type: "freeing"; model: string } | { type: "loading"; model: string; contextLength: number };

// Loads a model on a device when a request needs one that is not loaded yet, so picking any model "just works".
// Loads on one device go one at a time, and a second request for a model that is already loading waits for it.
export class ModelLoader {
  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Promise<void>>();
  private readonly unloadOthers: boolean;
  private readonly defaultContext: number;

  constructor(private opts: LoaderOptions) {
    this.unloadOthers = opts.unloadOthers ?? true;
    this.defaultContext = opts.defaultContext ?? 32_768;
  }

  ensure(target: Loadable, onStage?: (stage: LoadStage) => void): Promise<void> {
    const key = `${target.node.nodeId}\u0000${target.model}`;
    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    const nodeId = target.node.nodeId;
    const previous = this.queues.get(nodeId) ?? Promise.resolve();
    const run = previous
      .catch(() => {
        // An earlier failure on this device is not this request's problem.
      })
      .then(() => {
        return this.load(target, onStage);
      });
    const tail = run.catch(() => {
      // The queue only orders loads; each caller sees its own result.
    });
    this.queues.set(nodeId, tail);
    this.pending.set(key, run);
    void run
      .finally(() => {
        this.pending.delete(key);
        if (this.queues.get(nodeId) === tail) {
          this.queues.delete(nodeId);
        }
      })
      .catch(() => {
        // Reported to the caller through `run`.
      });
    return run;
  }

  private async load(target: Loadable, onStage?: (stage: LoadStage) => void): Promise<void> {
    const { nodeId } = target.node;
    // Another request may have loaded it while this one waited its turn.
    const current = this.opts.registry.live().find((n) => {
      return n.nodeId === nodeId;
    });
    if (current?.models.some((m) => {
      return m.id === target.model && m.loaded;
    })) {
      return;
    }

    if (this.unloadOthers) {
      for (const other of target.loadedOthers) {
        onStage?.({ type: "freeing", model: other });
        const freed = await this.opts.relay.callModel(nodeId, "unload", other);
        if (!freed.ok) {
          throw new Error(`could not free memory on ${nodeId} by unloading ${other}: ${freed.output}`);
        }
        this.opts.registry.setLoaded(nodeId, other, false);
      }
    }

    const contextLength = Math.min(target.maxContext ?? this.defaultContext, this.defaultContext);
    onStage?.({ type: "loading", model: target.model, contextLength });
    const loaded = await this.opts.relay.callModel(nodeId, "load", target.model, contextLength);
    if (!loaded.ok) {
      throw new Error(`${nodeId} could not load ${target.model}: ${loaded.output}`);
    }
    this.opts.registry.setLoaded(nodeId, target.model, true);
  }
}
