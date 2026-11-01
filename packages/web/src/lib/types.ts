// The shapes the gateway returns, for the parts of its API the page uses.
export type { SessionEvent, SessionInfo, SettingsReport, SettingKey, NodeRecord } from "@harness/core";

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
  claude: { available: boolean; device?: string; models: string[] };
}
