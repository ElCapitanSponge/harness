import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredSession } from "./sessions.js";
import { openDatabase, sqliteGroups, sqliteRules, sqliteStore } from "./sqlite.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-sqlite-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const session = (over: Partial<StoredSession> = {}): StoredSession => {
  return {
    id: ID,
    title: "Fix the bug",
    model: "qwen",
    device: "pc",
    root: "proj",
    created: 1,
    updated: 2,
    history: [{ role: "system", content: "sys" }],
    events: [{ type: "user", text: "hi" }],
    ...over,
  };
};

describe("openDatabase", () => {
  it("creates the file and its folder, and brings the schema up to date", async () => {
    const file = path.join(dir, "nested", "harness.db");
    const db = openDatabase(file);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBeGreaterThan(0);
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.close();
    await expect(fs.access(file)).resolves.toBeUndefined();
  });

  it("opens an existing database again without losing what is in it", () => {
    const file = path.join(dir, "harness.db");
    const first = openDatabase(file);
    void sqliteStore(first).save(session());
    first.close();
    const second = openDatabase(file);
    expect(sqliteStore(second).loadAll().map((s) => {
      return s.id;
    })).toEqual([ID]);
    second.close();
  });

  it("keeps the file private on systems that support modes", async (ctx) => {
    if (process.platform === "win32") {
      return ctx.skip();
    }
    const file = path.join(dir, "harness.db");
    openDatabase(file).close();
    expect((await fs.stat(file)).mode & 0o077).toBe(0);
  });
});

describe("sqliteStore", () => {
  it("saves a conversation and loads it back exactly", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    await store.save(session());
    expect(store.loadAll()).toEqual([session()]);
  });

  it("keeps the parent and depth of a sub-agent's conversation", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    await store.save(session({ id: "11111111-2222-4333-8444-555555555555", parent: "99999999-2222-4333-8444-555555555555", depth: 1 }));
    expect(store.loadAll()[0]).toMatchObject({ parent: "99999999-2222-4333-8444-555555555555", depth: 1 });
  });

  it("records whether a conversation is a chat or code", async () => {
    const db = openDatabase(":memory:");
    const store = sqliteStore(db);
    await store.save(session());
    await store.save(session({ id: "11111111-2222-4333-8444-555555555555", device: "", root: "" }));
    const kinds = db.prepare("SELECT kind FROM conversations ORDER BY kind").all() as { kind: string }[];
    expect(kinds.map((k) => {
      return k.kind;
    })).toEqual(["chat", "code"]);
  });

  it("adds only the new events on a later save and updates the title and history in place", async () => {
    const db = openDatabase(":memory:");
    const store = sqliteStore(db);
    await store.save(session());
    await store.save(
      session({ title: "Renamed", updated: 9, history: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], events: [{ type: "user", text: "hi" }, { type: "text", text: "hello" }] }),
    );
    const [loaded] = store.loadAll();
    expect(loaded).toMatchObject({ title: "Renamed", updated: 9 });
    expect(loaded?.events).toEqual([{ type: "user", text: "hi" }, { type: "text", text: "hello" }]);
    expect(loaded?.history).toHaveLength(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(2);
  });

  it("lists the most recently updated conversation first", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    await store.save(session({ updated: 1 }));
    await store.save(session({ id: "11111111-2222-4333-8444-555555555555", updated: 5 }));
    expect(store.loadAll().map((s) => {
      return s.updated;
    })).toEqual([5, 1]);
  });

  it("removes a conversation and its events together", async () => {
    const db = openDatabase(":memory:");
    const store = sqliteStore(db);
    await store.save(session());
    await store.remove(ID);
    expect(store.loadAll()).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(0);
  });

  it("does not half-save: a failure leaves the earlier state untouched", async () => {
    const db = openDatabase(":memory:");
    const store = sqliteStore(db);
    await store.save(session());
    // An event that cannot be stored (a cycle has no JSON form) must roll the whole save back.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(store.save(session({ title: "Changed", events: [{ type: "user", text: "hi" }, cyclic as never] }))).rejects.toThrow();
    expect(store.loadAll()[0]?.title).toBe("Fix the bug");
  });

  it("keeps order and content for many events", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    const many = Array.from({ length: 200 }, (_, i) => {
      return { type: "text" as const, text: `event ${i}` };
    });
    await store.save(session({ events: many }));
    expect(store.loadAll()[0]?.events).toEqual(many);
  });
});

describe("permission modes and rules in the database", () => {
  it("keeps the mode of a conversation", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    await store.save(session({ mode: "plan" }));
    expect(store.loadAll()[0]).toMatchObject({ mode: "plan" });
    await store.save(session({ mode: "edits" }));
    expect(store.loadAll()[0]).toMatchObject({ mode: "edits" });
  });

  it("keeps a conversation pinned, and not pinned by default", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    await store.save(session());
    expect(store.loadAll()[0]?.pinned).toBeUndefined();
    await store.save(session({ pinned: true }));
    expect(store.loadAll()[0]).toMatchObject({ pinned: true });
    await store.save(session({ pinned: false }));
    expect(store.loadAll()[0]?.pinned).toBeUndefined();
  });

  it("remembers a tool for a folder on a device once, lists it, and removes it", () => {
    const rules = sqliteRules(openDatabase(":memory:"));
    expect(rules.has("pc", "proj", "run_command")).toBe(false);
    rules.add("pc", "proj", "run_command");
    rules.add("pc", "proj", "run_command");
    rules.add("pc", "other", "run_command");
    expect(rules.has("pc", "proj", "run_command")).toBe(true);
    expect(rules.has("pc", "proj", "write_file")).toBe(false);
    expect(rules.has("mac", "proj", "run_command")).toBe(false);
    const listed = rules.list();
    expect(listed).toHaveLength(2);
    expect(rules.remove(listed[0]?.id ?? 0)).toBe(true);
    expect(rules.remove(listed[0]?.id ?? 0)).toBe(false);
    expect(rules.list()).toHaveLength(1);
  });
});

describe("collapsed sidebar groups in the database", () => {
  it("remembers which project groups are collapsed, once each, and forgets them when expanded", () => {
    const db = openDatabase(":memory:");
    const groups = sqliteGroups(db);
    expect(groups.list()).toEqual([]);
    groups.set("pc", "proj", true);
    groups.set("pc", "proj", true);
    groups.set("mac", "proj", true);
    expect(groups.list()).toEqual([{ device: "mac", root: "proj" }, { device: "pc", root: "proj" }]);
    groups.set("mac", "proj", false);
    expect(groups.list()).toEqual([{ device: "pc", root: "proj" }]);
  });
});
