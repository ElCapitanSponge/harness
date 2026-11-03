import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EFFORTS, PERMISSION_MODES, type ChatMessage, type SessionEvent } from "@harness/core";
import type { SessionStore, StoredSession } from "./sessions.js";

// Each entry upgrades the database by one version. Never edit one that has shipped; add another.
const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     model TEXT NOT NULL,
     device TEXT NOT NULL,
     root TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     history TEXT NOT NULL
   ) STRICT;
   CREATE INDEX conversations_updated ON conversations (updated DESC);
   CREATE TABLE events (
     conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (conversation_id, seq)
   ) STRICT, WITHOUT ROWID;`,
  `CREATE TABLE usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     time INTEGER NOT NULL,
     conversation_id TEXT NOT NULL,
     device TEXT NOT NULL,
     model TEXT NOT NULL,
     prompt_tokens INTEGER NOT NULL,
     completion_tokens INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     estimated INTEGER NOT NULL,
     context_length INTEGER
   ) STRICT;
   CREATE INDEX usage_time ON usage (time);
   CREATE INDEX usage_conversation ON usage (conversation_id, id);`,
  // The effort level chosen for a conversation, when one has been.
  `ALTER TABLE conversations ADD COLUMN effort TEXT;`,
  // The conversation that started this one as a sub-agent, and how deep it is.
  `ALTER TABLE conversations ADD COLUMN parent TEXT;
   ALTER TABLE conversations ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;`,
  // How a conversation treats changes, and the tools the person said to always allow in a folder on a device.
  `ALTER TABLE conversations ADD COLUMN mode TEXT;
   CREATE TABLE rules (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     device TEXT NOT NULL,
     root TEXT NOT NULL,
     tool TEXT NOT NULL,
     created INTEGER NOT NULL,
     UNIQUE (device, root, tool)
   ) STRICT;`,
  // The project groups the person has collapsed in the sidebar, kept here so every client shows the same.
  `CREATE TABLE collapsed_groups (
     device TEXT NOT NULL,
     root TEXT NOT NULL,
     PRIMARY KEY (device, root)
   ) STRICT;`,
  // Conversations pinned to the top of the sidebar.
  `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  // How many of a conversation's events the person has read. What was there before this is counted as read, so nothing old shows as new.
  `ALTER TABLE conversations ADD COLUMN read_events INTEGER NOT NULL DEFAULT 0;
   UPDATE conversations SET read_events = (SELECT COUNT(*) FROM events WHERE events.conversation_id = conversations.id);`,
  // Conversations put away in the Archive section of the sidebar.
  `ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
];

// Opens (creating if need be) the gateway's database on its data volume, in write-ahead mode so reads never wait for a write,
// and brings it up to the current version. Pass ":memory:" for tests.
export const openDatabase = (file: string): DatabaseSync => {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(file);
  if (file !== ":memory:") {
    // The database holds conversations, which can contain file contents, so it is private to the owner.
    fs.chmodSync(file, 0o600);
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version] ?? "");
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`could not upgrade the database to version ${version + 1}`, { cause: err });
    }
  }
  return db;
};

interface ConversationRow {
  id: string;
  kind: string;
  title: string;
  model: string;
  device: string;
  root: string;
  created: number;
  updated: number;
  history: string;
  effort: string | null;
  parent: string | null;
  depth: number;
  mode: string | null;
  pinned: number;
  archived: number;
  read_events: number;
}

// Stores conversations as a row each, with their events appended one row at a time. A turn adds events and never rewrites old ones.
export const sqliteStore = (db: DatabaseSync): SessionStore & { loadAll(): StoredSession[] } => {
  const upsert = db.prepare(
    `INSERT INTO conversations (id, kind, title, model, device, root, created, updated, history, effort, parent, depth, mode, pinned, archived, read_events)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, model = excluded.model, updated = excluded.updated, history = excluded.history, effort = excluded.effort, mode = excluded.mode, pinned = excluded.pinned, archived = excluded.archived, read_events = excluded.read_events`,
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE conversation_id = ?");
  const append = db.prepare("INSERT INTO events (conversation_id, seq, data) VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM conversations WHERE id = ?");
  const conversations = db.prepare("SELECT * FROM conversations ORDER BY updated DESC");
  const events = db.prepare("SELECT data FROM events WHERE conversation_id = ? ORDER BY seq");

  return {
    save(session) {
      db.exec("BEGIN");
      try {
        upsert.run(
          session.id,
          session.device === "" ? "chat" : "code",
          session.title,
          session.model,
          session.device,
          session.root,
          session.created,
          session.updated,
          JSON.stringify(session.history),
          session.effort ?? null,
          session.parent ?? null,
          session.depth ?? 0,
          session.mode ?? null,
          session.pinned === true ? 1 : 0,
          session.archived === true ? 1 : 0,
          session.read ?? 0,
        );
        const have = (count.get(session.id) as { n: number }).n;
        for (let seq = have; seq < session.events.length; seq++) {
          append.run(session.id, seq, JSON.stringify(session.events[seq]));
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      return Promise.resolve();
    },

    remove(id) {
      remove.run(id);
      return Promise.resolve();
    },

    loadAll() {
      return (conversations.all() as unknown as ConversationRow[]).map((row): StoredSession => {
        return {
          id: row.id,
          title: row.title,
          model: row.model,
          device: row.device,
          root: row.root,
          created: row.created,
          updated: row.updated,
          effort: EFFORTS.find((e) => {
            return e === row.effort;
          }),
          ...(row.parent ? { parent: row.parent } : {}),
          ...(row.pinned === 1 ? { pinned: true } : {}),
          ...(row.archived === 1 ? { archived: true } : {}),
          read: row.read_events,
          ...(PERMISSION_MODES.find((m) => {
            return m === row.mode;
          })
            ? { mode: PERMISSION_MODES.find((m) => {
                return m === row.mode;
              }) }
            : {}),
          ...(row.depth > 0 ? { depth: row.depth } : {}),
          history: JSON.parse(row.history) as ChatMessage[],
          events: (events.all(row.id) as unknown as { data: string }[]).map((e) => {
            return JSON.parse(e.data) as SessionEvent;
          }),
        };
      });
    },
  };
};

export interface PermissionRule {
  id: number;
  device: string;
  root: string;
  tool: string;
  created: number;
}

// The tools the person said to always allow in a folder on a device ("allow always in this project"), kept so they are not asked again,
// listed so they can be reviewed, and removable. The device's own allow list still has the last word.
export const sqliteRules = (db: DatabaseSync) => {
  const find = db.prepare("SELECT id FROM rules WHERE device = ? AND root = ? AND tool = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO rules (device, root, tool, created) VALUES (?, ?, ?, ?)");
  const all = db.prepare("SELECT id, device, root, tool, created FROM rules ORDER BY created DESC, id DESC");
  const remove = db.prepare("DELETE FROM rules WHERE id = ?");
  return {
    has: (device: string, root: string, tool: string): boolean => {
      return find.get(device, root, tool) !== undefined;
    },
    add: (device: string, root: string, tool: string): void => {
      insert.run(device, root, tool, Date.now());
    },
    list: (): PermissionRule[] => {
      return all.all() as unknown as PermissionRule[];
    },
    remove: (id: number): boolean => {
      return Number(remove.run(id).changes) > 0;
    },
  };
};

// Which project groups are collapsed in the sidebar. A project is a folder on a device; a chat with no project has neither.
export interface ProjectGroup {
  device: string;
  root: string;
}

export const sqliteGroups = (db: DatabaseSync) => {
  const all = db.prepare("SELECT device, root FROM collapsed_groups ORDER BY device, root");
  const insert = db.prepare("INSERT OR IGNORE INTO collapsed_groups (device, root) VALUES (?, ?)");
  const remove = db.prepare("DELETE FROM collapsed_groups WHERE device = ? AND root = ?");
  return {
    list: (): ProjectGroup[] => {
      return all.all() as unknown as ProjectGroup[];
    },
    set: (device: string, root: string, collapsed: boolean): void => {
      if (collapsed) {
        insert.run(device, root);
      } else {
        remove.run(device, root);
      }
    },
  };
};
