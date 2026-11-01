import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChatMessage, SessionEvent } from "@harness/core";
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
}

// Stores conversations as a row each, with their events appended one row at a time. A turn adds events and never rewrites old ones.
export const sqliteStore = (db: DatabaseSync): SessionStore & { loadAll(): StoredSession[] } => {
  const upsert = db.prepare(
    `INSERT INTO conversations (id, kind, title, model, device, root, created, updated, history)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, updated = excluded.updated, history = excluded.history`,
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
          history: JSON.parse(row.history) as ChatMessage[],
          events: (events.all(row.id) as unknown as { data: string }[]).map((e) => {
            return JSON.parse(e.data) as SessionEvent;
          }),
        };
      });
    },
  };
};
