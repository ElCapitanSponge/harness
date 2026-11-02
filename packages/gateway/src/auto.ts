import { supportsImages, type NodeRecord } from "@harness/core";

// Auto mode: which model should answer this turn. A pure function of the conversation and the pool, so it can be tested and its reasons
// read. The rules and why they are what they are are in docs/adr/0010-auto-mode-chooses-by-rules-and-explains-itself.md.

export interface AutoPrefs {
  // Model names, best first. A name matches any model id that contains it, so "qwen" covers every qwen. "claude" ranks Claude.
  prefer: string[];
  // Models never to choose, matched the same way.
  avoid: string[];
  // Devices that must stay free: nothing is chosen on them.
  keepFree: string[];
}

export interface AutoInput {
  // The conversation's size in tokens, including the message about to be sent.
  tokens: number;
  // A coding session needs tools, so a model with room to work.
  needsTools: boolean;
  // The message carries an image, so only a model that can read images will do (and not Claude, which is driven with text only).
  needsImages?: boolean;
  // The model that answered last, kept if it still fits.
  current?: string;
  nodes: NodeRecord[];
  // Claude's state, from the gateway: available now, and through which device.
  claude: { available: boolean; device?: string; limitedUntil?: number };
  prefs: AutoPrefs;
  // The window a model gets when it is loaded without being told one (what the loader uses).
  defaultContext?: number;
}

export interface AutoChoice {
  model: string;
  device: string;
  // In a few words, why. Shown with the reply.
  reason: string;
  // The model has to be loaded first.
  loads: boolean;
}

export type AutoResult = { chosen: AutoChoice } | { none: string };

const DEFAULT_CONTEXT = 32_768;
const CLAUDE_CONTEXT = 200_000;
// Room kept for the reply, and the share of the window a conversation may fill before a larger one is preferred.
const REPLY_ROOM = 1024;
const MARGIN = 1.2;
const CROWDED = 0.75;
// A coding session below this has no room for the system prompt, the tools and a few files.
const MIN_TOOL_WINDOW = 8000;

interface Candidate {
  model: string;
  device: string;
  window: number;
  loaded: boolean;
  claude: boolean;
  rank: number;
}

const matches = (id: string, name: string): boolean => {
  return id.toLowerCase().includes(name.trim().toLowerCase());
};

const preferenceRank = (id: string, prefer: string[]): number => {
  const index = prefer.findIndex((name) => {
    return name.trim() !== "" && matches(id, name);
  });
  return index === -1 ? prefer.length : index;
};

// An embedding model cannot answer, and the device lists it with the others.
const answersChats = (id: string): boolean => {
  return !/embed|rerank/i.test(id);
};

const describe = (n: number): string => {
  return n >= 1000 ? `${String(Math.round(n / 1000))}k` : String(n);
};

// Every model that could answer, on a device that is connected, not busy, not kept free, and either has it loaded or may load it.
const locals = (input: AutoInput): Candidate[] => {
  const defaultContext = input.defaultContext ?? DEFAULT_CONTEXT;
  return input.nodes.filter((n) => {
    return n.kind === "local" && !n.busy && !input.prefs.keepFree.includes(n.nodeId);
  }).flatMap((node) => {
    return node.models.flatMap((m): Candidate[] => {
      if (!answersChats(m.id) || input.prefs.avoid.some((a) => {
        return a.trim() !== "" && matches(m.id, a);
      })) {
        return [];
      }
      if (input.needsImages === true && !supportsImages(m.id)) {
        return [];
      }
      if (!m.loaded && !node.modelControl) {
        return [];
      }
      // A model that has to be loaded gets the loader's default window, or its own maximum if that is smaller.
      const window = m.loaded ? (m.contextLength ?? defaultContext) : Math.min(m.contextLength ?? defaultContext, defaultContext);
      return [{ model: m.id, device: node.nodeId, window, loaded: m.loaded, claude: false, rank: preferenceRank(m.id, input.prefs.prefer) }];
    });
  });
};

export const chooseModel = (input: AutoInput): AutoResult => {
  const needed = Math.ceil(input.tokens * MARGIN) + REPLY_ROOM;
  const fits = (c: Candidate): boolean => {
    return c.window >= needed && (!input.needsTools || c.window >= MIN_TOOL_WINDOW);
  };
  const claude: Candidate | undefined = input.claude.available && input.needsImages !== true && input.claude.device !== undefined && !input.prefs.avoid.some((a) => {
    return a.trim() !== "" && matches("claude", a);
  })
    ? { model: "claude", device: input.claude.device, window: CLAUDE_CONTEXT, loaded: true, claude: true, rank: preferenceRank("claude", input.prefs.prefer) }
    : undefined;

  const local = locals(input);
  const usable = local.filter(fits);
  const all = claude && fits(claude) ? [...usable, claude] : usable;

  // The model that answered last stays, so a conversation does not move around for no reason.
  const stay = all.find((c) => {
    return c.model === input.current;
  });
  if (stay) {
    return { chosen: { model: stay.model, device: stay.device, loads: !stay.loaded, reason: `staying on ${stay.model}: it still fits ${describe(input.tokens)} tokens${stay.loaded ? "" : " (it will be loaded again)"}` } };
  }

  // Local first, by the owner's order, loaded before not loaded, then a chat takes the smaller window and a coding session the larger.
  const best = [...usable].sort((a, b) => {
    return a.rank - b.rank || Number(b.loaded) - Number(a.loaded) || (input.needsTools ? b.window - a.window : a.window - b.window);
  })[0];

  // Claude is first when the owner puts it first, last when a local model is comfortable, and the answer when nothing local will do.
  const claudeFirst = claude !== undefined && fits(claude) && (best === undefined || claude.rank < best.rank);
  const crowded = best !== undefined && needed > best.window * CROWDED;
  if (claude && fits(claude) && (claudeFirst || best === undefined || crowded)) {
    const why = best === undefined
      ? local.length === 0 ? "no local model is ready" : `no local model has room for ${describe(input.tokens)} tokens`
      : claudeFirst ? "you put Claude first" : `${describe(input.tokens)} tokens is close to what ${best.model} holds`;
    return { chosen: { model: claude.model, device: claude.device, loads: false, reason: `Claude: ${why}` } };
  }
  if (best) {
    const where = `${best.loaded ? "loaded" : "loads"} on ${best.device}`;
    const sizeNote = input.needsTools ? "has room to work" : `fits ${describe(input.tokens)} tokens`;
    const ranked = best.rank < input.prefs.prefer.length ? ", your first choice" : "";
    return { chosen: { model: best.model, device: best.device, loads: !best.loaded, reason: `${best.model}: ${where}, ${sizeNote}${ranked}` } };
  }

  // Nothing fits or is ready: say why, in terms that can be acted on.
  const connected = input.nodes.filter((n) => {
    return n.kind === "local";
  });
  const claudeNote = input.claude.limitedUntil !== undefined ? `Claude is limited until ${new Date(input.claude.limitedUntil).toLocaleTimeString()}` : "Claude is not available";
  if (connected.length === 0 && !claude) {
    return { none: `Auto found no model to use: no device is connected, and ${claudeNote.charAt(0).toLowerCase()}${claudeNote.slice(1)}. Connect a device, or pick a model yourself.` };
  }
  const busy = connected.filter((n) => {
    return n.busy;
  });
  const parts: string[] = [];
  if (local.length === 0) {
    parts.push(connected.length === 0
      ? "no device is connected"
      : busy.length === connected.length
        ? `every device is busy (${busy.map((n) => {
          return n.nodeId;
        }).join(", ")})`
        : "no connected device has a model it can use (loaded, or loadable with model control on)");
  } else {
    const biggest = Math.max(...local.map((c) => {
      return c.window;
    }));
    parts.push(input.needsTools && biggest < MIN_TOOL_WINDOW ? `the largest local window (${describe(biggest)} tokens) is too small for a coding session` : `no local model has room for ${describe(input.tokens)} tokens (the largest holds ${describe(biggest)})`);
  }
  parts.push(claude ? "Claude does not have room either" : claudeNote);
  return { none: `Auto found no model to use: ${parts.join("; ")}. Pick a model yourself, or compact the conversation.` };
};

// Reads the owner's list settings ("qwen, gemma") into names.
export const parseList = (value: string | undefined): string[] => {
  return (value ?? "").split(",").map((s) => {
    return s.trim();
  }).filter(Boolean);
};
