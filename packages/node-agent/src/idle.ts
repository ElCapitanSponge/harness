import type { AuditEntry } from "./audit.js";

// Frees a device's graphics card by unloading a model nobody has used for a while. A model is only ever unloaded if Torii used
// it (a chat request came through this agent, or the gateway loaded it), so a model the owner loaded in LM Studio for their own
// use is left alone. A model with a reply in progress is never unloaded.

export interface IdleOptions {
  // How long a model may sit unused, in minutes. Zero turns unloading off.
  minutes: () => number;
  // Whether this device lets the gateway control its models at all.
  enabled: () => boolean;
  unload: (model: string) => Promise<unknown>;
  now?: () => number;
  log?: (message: string) => void;
  audit?: (entry: AuditEntry) => void;
}

interface Use {
  last: number;
  inflight: number;
}

export const createIdleUnloader = (opts: IdleOptions) => {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console.log;
  const uses = new Map<string, Use>();

  const use = (model: string): Use => {
    let entry = uses.get(model);
    if (!entry) {
      entry = { last: now(), inflight: 0 };
      uses.set(model, entry);
    }
    return entry;
  };

  return {
    // A request for the model began, or it finished: either way it was just used.
    start(model: string): void {
      const entry = use(model);
      entry.inflight++;
      entry.last = now();
    },
    end(model: string): void {
      const entry = use(model);
      entry.inflight = Math.max(0, entry.inflight - 1);
      entry.last = now();
    },
    // The gateway loaded it, so the clock starts then.
    touch(model: string): void {
      use(model).last = now();
    },
    forget(model: string): void {
      uses.delete(model);
    },
    tracked(): { model: string; idleMs: number; inflight: number }[] {
      return [...uses.entries()].map(([model, u]) => {
        return { model, idleMs: now() - u.last, inflight: u.inflight };
      });
    },
    // Unloads every model idle for longer than the limit. Returns the ones it unloaded.
    async check(): Promise<string[]> {
      const minutes = opts.minutes();
      if (!opts.enabled() || minutes <= 0) {
        return [];
      }
      const limit = minutes * 60_000;
      const done: string[] = [];
      for (const [model, u] of uses) {
        if (u.inflight > 0 || now() - u.last < limit) {
          continue;
        }
        const started = now();
        try {
          await opts.unload(model);
          log(`[agent] unloaded ${model} after ${String(minutes)} minutes without use`);
          opts.audit?.({ time: new Date(started).toISOString(), root: "", tool: "idle-unload", summary: `unloaded ${model} after ${String(minutes)} minutes without use`, outcome: "ok", ms: now() - started });
          done.push(model);
        } catch (err) {
          // It may already be gone (the owner unloaded it); either way it is no longer ours to watch.
          log(`[agent] could not unload ${model}: ${err instanceof Error ? err.message : String(err)}`);
        }
        uses.delete(model);
      }
      return done;
    },
  };
};

export type IdleUnloader = ReturnType<typeof createIdleUnloader>;
