import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacySessions, loadStored } from "./legacy.js";
import type { StoredSession } from "./sessions.js";
import { openDatabase, sqliteStore } from "./sqlite.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-legacy-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(`${dir}.imported`, { recursive: true, force: true });
});

const ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const legacy = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  return {
    id: ID,
    model: "qwen",
    device: "pc",
    root: "proj",
    created: 1,
    history: [{ role: "system", content: "sys" }],
    events: [{ type: "user", text: "  fix the   bug in sum.js " }],
    ...over,
  };
};
const write = (name: string, content: unknown): Promise<void> => {
  return fs.writeFile(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
};

describe("loadStored", () => {
  it("reads an old session and gives it a title from its first message and an updated time", async () => {
    await write(`${ID}.json`, legacy());
    const [session] = await loadStored(dir);
    expect(session).toMatchObject({ id: ID, title: "fix the bug in sum.js", updated: 1, device: "pc" });
  });

  it("keeps the title and updated time of a session that already has them", async () => {
    await write(`${ID}.json`, legacy({ title: "Mine", updated: 99 }));
    expect((await loadStored(dir))[0]).toMatchObject({ title: "Mine", updated: 99 });
  });

  it("returns nothing for a folder that does not exist", async () => {
    expect(await loadStored(path.join(dir, "missing"))).toEqual([]);
  });

  it("skips files that are not valid sessions, with a warning, and keeps the good ones", async () => {
    await write(`${ID}.json`, legacy());
    await write("broken.json", "{not json");
    await write(`${ID.replace("0b", "ff")}.json`, legacy());
    await write("notes.txt", "ignored");
    const warnings: string[] = [];
    const loaded = await loadStored(dir, (m) => {
      warnings.push(m);
    });
    expect(loaded.map((s) => {
      return s.id;
    })).toEqual([ID]);
    expect(warnings).toHaveLength(2);
  });

  it("rejects a file whose name does not match the id inside it", async () => {
    await write("other.json", legacy());
    expect(await loadStored(dir, () => {
      return undefined;
    })).toEqual([]);
  });
});

describe("importLegacySessions", () => {
  it("moves the old sessions into the database once and sets the folder aside without deleting anything", async () => {
    await write(`${ID}.json`, legacy());
    const store = sqliteStore(openDatabase(":memory:"));

    expect(await importLegacySessions(dir, store)).toBe(1);
    const stored: StoredSession[] = store.loadAll();
    expect(stored.map((s) => {
      return s.id;
    })).toEqual([ID]);
    expect(await fs.readdir(`${dir}.imported`)).toEqual([`${ID}.json`]);

    // The folder is gone from where it was read, so a second start imports nothing.
    expect(await importLegacySessions(dir, store)).toBe(0);
  });

  it("does nothing when there is nothing to import", async () => {
    expect(await importLegacySessions(dir, sqliteStore(openDatabase(":memory:")))).toBe(0);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
