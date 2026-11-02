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

// A transcript split into turns, as the gateway reads it, for the person to check before it is saved.
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface ImportedConversation {
  title: string;
  source: string;
  turns: Turn[];
}

export interface ParsedImport {
  conversations: ImportedConversation[];
  format: string;
  split: boolean;
}

// A command a coding session started in the background on its device.
export interface BackgroundTask {
  id: string;
  command: string;
  status: "running" | "exited" | "stopped";
  code?: number | null;
  startedAt: number;
}

// A skill in the gateway's own library, with how many files it has and how big they are together.
export interface LibrarySkill extends SkillInfo {
  files: number;
  bytes: number;
}

// A tool the person said to always allow in a folder on a device.
export interface PermissionRule {
  id: number;
  device: string;
  root: string;
  tool: string;
  created: number;
}

export type CatalogueState = "loaded" | "loads-on-use" | "cannot-load" | "busy" | "limited";

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
