// The shapes the gateway returns, for the parts of its API the page uses.
export type { ClaudeStatus, ClaudeWindow, ConversationUsage, ModelUsage, NodeRecord, SessionEvent, SessionInfo, SettingKey, SettingsReport, UsageSummary } from "@harness/core";

// What a device found in one of its project folders: skills (as listed for the model and for the person), the ones it skipped with
// the reason, and the instruction files it read.
export interface SkillInfo {
  name: string;
  description: string;
  hint?: string;
  length: number;
  // False when only the person starts it.
  modelInvocable: boolean;
  source: string;
}

export interface SkillsFolder {
  device: string;
  root: string;
  skills: SkillInfo[];
  skipped: { path: string; reason: string }[];
  instructions: { source: string; length: number }[];
  // Why nothing was found, when the device could not answer.
  note?: string;
}

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
