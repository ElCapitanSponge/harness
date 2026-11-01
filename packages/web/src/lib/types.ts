// The shapes the gateway returns, for the parts of its API the page uses.
export type { ClaudeStatus, ClaudeWindow, ConversationUsage, ModelUsage, NodeRecord, SessionEvent, SessionInfo, SettingKey, SettingsReport, UsageSummary } from "@harness/core";

export type CatalogueState = "loaded" | "loads-on-use" | "cannot-load" | "busy";

export interface CatalogueEntry {
  id: string;
  device: string;
  state: CatalogueState;
  contextLength?: number;
  busyReason?: string;
}

export interface Catalogue {
  models: CatalogueEntry[];
  // `limitedUntil` is set (milliseconds since the epoch) while Claude is at its usage limit.
  claude: { available: boolean; device?: string; models: string[]; limitedUntil?: number };
}
