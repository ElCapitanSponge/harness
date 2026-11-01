import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatMessage, Heartbeat } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import { Sessions, type Complete, type StoredSession } from "./sessions.js";
import { fileStore, loadStored } from "./store.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-store-"));
});
afterEach(() => {
  return fs.rm(dir, { recursive: true, force: true });
});

const ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const stored = (over: Partial<StoredSession> = {}): StoredSession => {
  return {
    id: ID,
    model: "qwen",
    device: "pc",
    root: "proj",
    created: 1,
    history: [{ role: "system", content: "sys" }],
    events: [{ type: "user", text: "hi" }],
    ...over,
  };
};

describe("fileStore", () => {
  it("saves a session as JSON that loadStored reads back", async () => {
    await fileStore(dir).save(stored());
    expect(await loadStored(dir)).toEqual([stored()]);
  });

  it("overwrites on a later save, leaving no temporary files", async () => {
    const store = fileStore(dir);
    await Promise.all([store.save(stored({ events: [] })), store.save(stored({ events: [{ type: "user", text: "later" }] }))]);
    expect((await loadStored(dir))[0]?.events).toEqual([{ type: "user", text: "later" }]);
    expect(await fs.readdir(dir)).toEqual([`${ID}.json`]);
  });

  it("removes a session", async () => {
    const store = fileStore(dir);
    await store.save(stored());
    await store.remove(ID);
    expect(await loadStored(dir)).toEqual([]);
  });

  it("refuses ids that are not generated ids, so they cannot reach a path", async () => {
    await expect(fileStore(dir).save(stored({ id: "../evil" }))).rejects.toThrow("invalid session id");
    await expect(fileStore(dir).remove("../evil")).rejects.toThrow("invalid session id");
  });

  it("does not make the file readable by others on systems that support modes", async (ctx) => {
    if (process.platform === "win32") {
      return ctx.skip();
    }
    await fileStore(dir).save(stored());
    expect((await fs.stat(path.join(dir, `${ID}.json`))).mode & 0o077).toBe(0);
  });
});

describe("loadStored", () => {
  it("returns nothing for a folder that does not exist", async () => {
    expect(await loadStored(path.join(dir, "missing"))).toEqual([]);
  });

  it("skips files that are not valid sessions, with a warning, and keeps the good ones", async () => {
    await fileStore(dir).save(stored());
    await fs.writeFile(path.join(dir, "broken.json"), "{not json");
    await fs.writeFile(path.join(dir, `${ID.replace("0b", "ff")}.json`), JSON.stringify(stored()));
    await fs.writeFile(path.join(dir, "notes.txt"), "ignored");
    const warnings: string[] = [];
    const loaded = await loadStored(dir, (m) => {
      return warnings.push(m);
    });
    expect(loaded.map((s) => {
      return s.id;
    })).toEqual([ID]);
    expect(warnings).toHaveLength(2);
  });

  it("rejects a file whose name does not match the id inside it", async () => {
    await fs.writeFile(path.join(dir, "other.json"), JSON.stringify(stored()));
    expect(await loadStored(dir, () => {
      return undefined;
    })).toEqual([]);
  });
});

describe("sessions that survive a restart", () => {
  const beat = (over: Partial<Heartbeat> = {}): Heartbeat => {
    return {
      nodeId: "pc",
      kind: "local",
      busy: false,
      models: [{ id: "qwen", loaded: true }],
      roots: ["proj"],
      allowedTools: ["read_file"],
      ...over,
    };
  };
  const until = async (check: () => boolean | Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 1000 && !(await check()); i++) {
      await new Promise((r) => {
        return setTimeout(r, 10);
      });
    }
    expect(await check()).toBe(true);
  };

  const boot = (registry: Registry, stored: StoredSession[], complete: Complete) => {
    const relay = { callTool: vi.fn(async () => {
      return { ok: true, output: "x" };
    }) };
    return new Sessions({ registry, relay: relay, complete, store: fileStore(dir), stored });
  };

  it("brings a finished session back with its history, so the conversation continues", async () => {
    const registry = new Registry();
    registry.upsert(beat());
    const seen: ChatMessage[][] = [];
    const complete: Complete = async (_m, messages) => {
      seen.push([...messages]);
      return { role: "assistant", content: `reply ${seen.length}` };
    };

    const first = boot(registry, [], complete);
    const session = first.create({ model: "qwen", device: "pc", root: "proj" });
    session.send("one");
    await until(() => {
      return !session.busy;
    });
    await until(async () => {
      return (await loadStored(dir)).length === 1 && (await loadStored(dir))[0]!.events.length === 3;
    });

    // "Restart": a fresh Sessions reading what was saved.
    const second = boot(registry, await loadStored(dir), complete);
    const back = second.get(session.id)!;
    expect(back.events.map((e) => {
      return e.type;
    })).toEqual(["user", "text", "done"]);
    expect(second.list()[0]).toMatchObject({ id: session.id, busy: false, deviceConnected: true });

    back.send("two");
    await until(() => {
      return !back.busy;
    });
    expect(seen[1]!.map((m) => {
      return m.role;
    })).toEqual(["system", "user", "assistant", "user"]);
  });

  it("can be read but not continued while its device is away", async () => {
    const registry = new Registry();
    registry.upsert(beat());
    const first = boot(registry, [], async () => {
      return { role: "assistant", content: "ok" };
    });
    const s = first.create({ model: "qwen", device: "pc", root: "proj" });
    s.send("hi");
    await until(() => {
      return !s.busy;
    });
    await new Promise((r) => {
      return setTimeout(r, 50);
    });

    const empty = new Registry();
    const second = boot(empty, await loadStored(dir), async () => {
      return { role: "assistant", content: "ok" };
    });
    const back = second.get(s.id)!;
    expect(back.events.length).toBeGreaterThan(0);
    expect(second.list()[0]?.deviceConnected).toBe(false);
    expect(() => {
      back.send("again");
    }).toThrow("not connected");
    expect(back.busy).toBe(false);
  });

  it("does not write a session back after it was deleted mid-turn", async () => {
    const registry = new Registry();
    registry.upsert(beat());
    let release!: (m: ChatMessage) => void;
    const sessions = boot(registry, [], () => {
      return new Promise((resolve) => {
        return (release = resolve);
      });
    });
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj" });
    await until(async () => {
      return (await loadStored(dir)).length === 1;
    });
    s.send("hi");

    expect(await sessions.delete(s.id)).toBe(true);
    release({ role: "assistant", content: "late" });
    await until(() => {
      return !s.busy;
    });
    await new Promise((r) => {
      return setTimeout(r, 100);
    });
    expect(await loadStored(dir)).toEqual([]);
  });

  it("deletes a session from memory and from disk", async () => {
    const registry = new Registry();
    registry.upsert(beat());
    const sessions = boot(registry, [], async () => {
      return { role: "assistant", content: "ok" };
    });
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj" });
    await until(async () => {
      return (await loadStored(dir)).length === 1;
    });

    expect(await sessions.delete(s.id)).toBe(true);
    expect(sessions.get(s.id)).toBeUndefined();
    expect(await loadStored(dir)).toEqual([]);
    expect(await sessions.delete(s.id)).toBe(false);
  });
});
