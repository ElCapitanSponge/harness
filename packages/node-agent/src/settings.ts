import fs from "node:fs/promises";
import path from "node:path";
import { DeviceSettings, SETTING_KEYS, nonEmpty, type SettingKey, type SettingsReport } from "@harness/core";
import { findTool } from "@harness/tools";
import type { AuditEntry } from "./audit.js";
import { parseRoots } from "./toolserver.js";

// The environment variable that fixes each setting. A setting with its variable set is locked: the owner chose it
// where the gateway cannot reach, so a remote change is refused.
export const SETTING_ENV: Record<SettingKey, string> = {
  projectRoots: "PROJECT_ROOTS",
  allowedTools: "ALLOWED_TOOLS",
  modelControl: "ALLOW_MODEL_CONTROL",
  claude: "CLAUDE_ENABLED",
  gameProcesses: "GAME_PROCESSES",
};

const DEFAULTS: DeviceSettings = {
  projectRoots: {},
  allowedTools: ["read_file", "list_dir", "grep"],
  modelControl: false,
  claude: false,
  gameProcesses: ["RocketLeague.exe", "Fortnite.exe", "eldenring.exe", "cs2.exe", "Cyberpunk2077.exe"],
};

const list = (value: string): string[] => {
  return value.split(",").map((s) => {
    return s.trim();
  }).filter(Boolean);
};

const fromEnv = (key: SettingKey, value: string): DeviceSettings[SettingKey] => {
  switch (key) {
    case "projectRoots":
      return parseRoots(value);
    case "modelControl":
    case "claude":
      return value === "1";
    default:
      return list(value);
  }
};

// Checks what a schema cannot: that the tools exist and that the folders are there.
const checkValue = async (key: SettingKey, value: unknown): Promise<string | undefined> => {
  if (key === "allowedTools") {
    const unknown = (value as string[]).filter((name) => {
      return !findTool(name);
    });
    return unknown.length > 0 ? `unknown tool: ${unknown.join(", ")}` : undefined;
  }
  if (key === "projectRoots") {
    for (const [name, dir] of Object.entries(value as Record<string, string>)) {
      const stat = await fs.stat(path.resolve(dir)).catch(() => {
        return undefined;
      });
      if (!stat?.isDirectory()) {
        return `project root "${name}" is not a folder on this device: ${dir}`;
      }
    }
  }
  return undefined;
};

export interface SettingsOptions {
  // Where applied settings are saved, so the device starts the same way when the gateway is down.
  file: string;
  env?: NodeJS.ProcessEnv;
  // Whether the gateway may change settings at all (REMOTE_CONFIG=1).
  remoteConfig: boolean;
  audit?: (entry: AuditEntry) => void;
  // Called with the new effective settings after a change, so the servers can pick them up without a restart.
  onChange?: (settings: DeviceSettings) => void;
  warn?: (message: string) => void;
}

export type ApplyResult = { ok: true; report: SettingsReport } | { ok: false; error: string };

// A device's settings: defaults, then the saved file, then environment variables, which win and lock the setting.
export const createSettings = async (opts: SettingsOptions) => {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? console.warn;
  const saved: Partial<Record<SettingKey, unknown>> = {};

  try {
    const parsed: unknown = JSON.parse(await fs.readFile(opts.file, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      for (const key of SETTING_KEYS) {
        const result = DeviceSettings.shape[key].safeParse((parsed as Record<string, unknown>)[key]);
        if (result.success) {
          saved[key] = result.data;
        } else if ((parsed as Record<string, unknown>)[key] !== undefined) {
          warn(`[agent] ignoring invalid saved setting ${key} in ${opts.file}`);
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      warn(`[agent] cannot read the settings file ${opts.file}: ${(err as Error).message}`);
    }
  }

  const envValue = (key: SettingKey): string | undefined => {
    const raw = env[SETTING_ENV[key]];
    return key === "modelControl" || key === "claude" ? raw : nonEmpty(raw);
  };
  const isLocked = (key: SettingKey): boolean => {
    return envValue(key) !== undefined && envValue(key) !== "";
  };

  const resolve = (): DeviceSettings => {
    const out: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      const fixed = envValue(key);
      out[key] = isLocked(key) && fixed !== undefined ? fromEnv(key, fixed) : (saved[key] ?? DEFAULTS[key]);
    }
    return out as unknown as DeviceSettings;
  };

  const report = (): SettingsReport => {
    const sources = {} as SettingsReport["sources"];
    for (const key of SETTING_KEYS) {
      sources[key] = isLocked(key) ? "env" : saved[key] === undefined ? "default" : "file";
    }
    return { settings: resolve(), sources, locked: SETTING_KEYS.filter(isLocked), remoteConfig: opts.remoteConfig };
  };

  const record = (summary: string, outcome: AuditEntry["outcome"], detail?: string): void => {
    opts.audit?.({ time: new Date().toISOString(), root: "", tool: "settings", summary, outcome, ...(detail ? { detail } : {}), ms: 0 });
  };

  const save = async (): Promise<void> => {
    await fs.mkdir(path.dirname(opts.file), { recursive: true });
    const tmp = `${opts.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await fs.rename(tmp, opts.file);
  };

  return {
    current: resolve,
    report,
    // Applies a partial change from the gateway. Nothing changes unless every part of it is valid.
    async apply(patch: unknown): Promise<ApplyResult> {
      const refuse = (error: string): ApplyResult => {
        record("refused a settings change", "refused", error);
        return { ok: false, error };
      };
      if (!opts.remoteConfig) {
        return refuse("this device does not accept remote settings changes (start its agent with REMOTE_CONFIG=1)");
      }
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
        return refuse("settings must be an object");
      }
      const entries = Object.entries(patch);
      const accepted: [SettingKey, unknown][] = [];
      for (const [name, value] of entries) {
        const key = SETTING_KEYS.find((k) => {
          return k === name;
        });
        if (!key) {
          return refuse(`unknown setting "${name}"`);
        }
        if (isLocked(key)) {
          return refuse(`${key} is fixed by the ${SETTING_ENV[key]} environment variable on this device`);
        }
        const parsed = DeviceSettings.shape[key].safeParse(value);
        if (!parsed.success) {
          return refuse(`${key} is not valid: ${parsed.error.issues[0]?.message ?? "wrong shape"}`);
        }
        const problem = await checkValue(key, parsed.data);
        if (problem) {
          return refuse(problem);
        }
        accepted.push([key, parsed.data]);
      }
      if (accepted.length === 0) {
        return { ok: true, report: report() };
      }
      const before = { ...saved };
      for (const [key, value] of accepted) {
        saved[key] = value;
      }
      try {
        await save();
      } catch (err) {
        for (const key of SETTING_KEYS) {
          if (before[key] === undefined) {
            Reflect.deleteProperty(saved, key);
          } else {
            saved[key] = before[key];
          }
        }
        return refuse(`could not save the settings file: ${(err as Error).message}`);
      }
      record(`changed ${accepted.map(([key]) => {
        return key;
      }).join(", ")}`, "ok", JSON.stringify(Object.fromEntries(accepted)).slice(0, 200));
      opts.onChange?.(resolve());
      return { ok: true, report: report() };
    },
  };
};

export type Settings = Awaited<ReturnType<typeof createSettings>>;
