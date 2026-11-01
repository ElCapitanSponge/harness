import type { DatabaseSync } from "node:sqlite";
import type { ConversationUsage, ModelUsage, UsageSummary } from "@harness/core";

// One model call. Kept after the conversation is deleted, so totals do not shrink when a chat is tidied away.
export interface UsageRecord {
  time: number;
  conversationId: string;
  device: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  estimated: boolean;
  contextLength?: number;
}

export interface UsageLedger {
  record(entry: UsageRecord): void;
  forConversation(id: string): ConversationUsage;
  summary(days: number, now?: number, offsetMinutes?: number): UsageSummary;
}

interface ModelRow {
  model: string;
  device: string;
  calls: number;
  prompt: number;
  completion: number;
  estimated: number;
}

const toModelUsage = (row: ModelRow): ModelUsage => {
  return { model: row.model, device: row.device, calls: row.calls, promptTokens: row.prompt, completionTokens: row.completion, estimated: row.estimated > 0 };
};

const DAY_MS = 86_400_000;

// A ledger of every model call in the gateway's database.
export const sqliteLedger = (db: DatabaseSync): UsageLedger => {
  const insert = db.prepare(
    `INSERT INTO usage (time, conversation_id, device, model, prompt_tokens, completion_tokens, duration_ms, estimated, context_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const latest = db.prepare(
    "SELECT model, device, prompt_tokens AS prompt, completion_tokens AS completion, context_length AS context, estimated FROM usage WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
  );
  const perModel = (where: string) => {
    return db.prepare(
      `SELECT model, device, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt, SUM(completion_tokens) AS completion, MAX(estimated) AS estimated
       FROM usage WHERE ${where} GROUP BY model, device ORDER BY SUM(prompt_tokens + completion_tokens) DESC`,
    );
  };
  const modelsOfConversation = perModel("conversation_id = ?");
  const modelsSince = perModel("time >= ?");
  const devicesSince = db.prepare(
    `SELECT device, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt, SUM(completion_tokens) AS completion
     FROM usage WHERE time >= ? GROUP BY device ORDER BY SUM(prompt_tokens + completion_tokens) DESC`,
  );
  const daysSince = db.prepare(
    `SELECT strftime('%Y-%m-%d', (time / 1000) + ?, 'unixepoch') AS day, model, SUM(prompt_tokens + completion_tokens) AS tokens
     FROM usage WHERE time >= ? GROUP BY day, model ORDER BY day, model`,
  );

  return {
    record(entry) {
      insert.run(entry.time, entry.conversationId, entry.device, entry.model, entry.promptTokens, entry.completionTokens, entry.durationMs, entry.estimated ? 1 : 0, entry.contextLength ?? null);
    },

    forConversation(id) {
      const row = latest.get(id) as { model: string; device: string; prompt: number; completion: number; context: number | null; estimated: number } | undefined;
      return {
        last: row
          ? { model: row.model, device: row.device, promptTokens: row.prompt, completionTokens: row.completion, contextLength: row.context ?? undefined, estimated: row.estimated > 0 }
          : undefined,
        byModel: (modelsOfConversation.all(id) as unknown as ModelRow[]).map(toModelUsage),
      };
    },

    // The last `days` days, counted from the start of the caller's local day, so "1" is today and "7" is a week ending today.
    summary(days, now = Date.now(), offsetMinutes = 0) {
      const offsetMs = offsetMinutes * 60_000;
      const startOfToday = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
      const since = startOfToday - (days - 1) * DAY_MS;
      const byModel = (modelsSince.all(since) as unknown as ModelRow[]).map(toModelUsage);
      const byDevice = (devicesSince.all(since) as unknown as { device: string; calls: number; prompt: number; completion: number }[]).map((r) => {
        return { device: r.device, calls: r.calls, promptTokens: r.prompt, completionTokens: r.completion };
      });
      const byDay = (daysSince.all(offsetMinutes * 60, since) as unknown as { day: string; model: string; tokens: number }[]).map((r) => {
        return { day: r.day, model: r.model, tokens: r.tokens };
      });
      return {
        days,
        since,
        calls: byModel.reduce((n, m) => {
          return n + m.calls;
        }, 0),
        promptTokens: byModel.reduce((n, m) => {
          return n + m.promptTokens;
        }, 0),
        completionTokens: byModel.reduce((n, m) => {
          return n + m.completionTokens;
        }, 0),
        byModel,
        byDevice,
        byDay,
      };
    },
  };
};

// A rough token count for when a model server reports none: about four characters to a token.
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};
