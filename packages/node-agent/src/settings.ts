import fs from "node:fs/promises";
import path from "node:path";
import { DeviceSettings, SETTING_KEYS, ToolAccess, nonEmpty, type SettingKey, type SettingsReport } from "@harness/core";
import { findTool, toolNamesFor, tools as allTools } from "@harness/tools";
import type { AuditEntry } from "./audit.js";
import { parseRoots } from "./toolserver.js";

// The environment variable that fixes each setting. A setting with its variable set is locked: the owner chose it
// where the gateway cannot reach, so a remote change is refused.
export const SETTING_ENV: Record<SettingKey, string> = {
  projectRoots: "PROJECT_ROOTS",
  readOnlyRoots: "READ_ONLY_ROOTS",
  onDeviceTools: "ALLOW_ON_DEVICE_TOOLS",
  remoteTools: "ALLOW_REMOTE_TOOLS",
  modelControl: "ALLOW_MODEL_CONTROL",
  claude: "CLAUDE_ENABLED",
  gameProcesses: "GAME_PROCESSES",
  idleUnloadMinutes: "IDLE_UNLOAD_MINUTES",
  limitedProcesses: "LIMITED_PROCESSES",
  limitedMaxGb: "LIMITED_MAX_GB",
  skillFolders: "SKILL_FOLDERS",
};

const DEFAULTS: DeviceSettings = {
  projectRoots: {},
  readOnlyRoots: [],
  // Reading on the device is on, as it always was; reaching out (the web, GitHub) and changing anything are off until chosen.
  onDeviceTools: "read",
  remoteTools: "off",
  modelControl: false,
  claude: false,
  gameProcesses: ["RocketLeague.exe", "Fortnite.exe", "eldenring.exe", "cs2.exe", "Cyberpunk2077.exe"],
  idleUnloadMinutes: 20,
  // Calls and meetings: the device keeps working, but only with models up to this size.
  limitedProcesses: ["ms-teams.exe", "Teams.exe"],
  limitedMaxGb: 8,
  skillFolders: [],
};

const list = (value: string): string[] => {
  return value.split(",").map((s) => {
    return s.trim();
  }).filter(Boolean);
};

// An access level from text, where anything unrecognised means off, which is the safe reading.
const accessOf = (value: string): ToolAccess => {
  const parsed = ToolAccess.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : "off";
};

// The access levels a list of tool names amounts to: the most a group's tools in the list can do.
export const accessOfTools = (names: string[]): { onDeviceTools: ToolAccess; remoteTools: ToolAccess } => {
  const level = (group: "device" | "remote"): ToolAccess => {
    const picked = allTools.filter((t) => {
      return t.group === group && names.includes(t.def.function.name);
    });
    if (picked.some((t) => {
      return t.level === "change";
    })) {
      return "change";
    }
    return picked.length > 0 ? "read" : "off";
  };
  return { onDeviceTools: level("device"), remoteTools: level("remote") };
};

const fromEnv = (key: SettingKey, value: string): DeviceSettings[SettingKey] => {
  switch (key) {
    case "onDeviceTools":
    case "remoteTools":
      return accessOf(value);
    case "projectRoots":
      return parseRoots(value);
    case "modelControl":
    case "claude":
      return value === "1";
    case "idleUnloadMinutes": {
      const minutes = Number(value);
      return Number.isFinite(minutes) ? Math.min(Math.max(Math.floor(minutes), 0), 1440) : DEFAULTS.idleUnloadMinutes;
    }
    case "limitedMaxGb": {
      const gb = Number(value);
      return Number.isFinite(gb) ? Math.min(Math.max(gb, 1), 512) : DEFAULTS.limitedMaxGb;
    }
    default:
      return list(value);
  }
};

// Checks what a schema cannot: that the folders are there.
const checkValue = async (key: SettingKey, value: unknown): Promise<string | undefined> => {
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
  if (key === "skillFolders") {
    for (const dir of value as string[]) {
      if (!path.isAbsolute(dir)) {
        return `skill folder "${dir}" must be a full path`;
      }
      const stat = await fs.stat(dir).catch(() => {
        return undefined;
      });
      if (!stat?.isDirectory()) {
        return `skill folder "${dir}" is not a folder on this device`;
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
  // Whether a program the tools need is installed on this device.
  installed?: (program: string) => boolean;
  warn?: (message: string) => void;
}

export type ApplyResult = { ok: true; report: SettingsReport } | { ok: false; error: string };

// A device's settings: defaults, then the saved file, then environment variables, which win and lock the setting.
export const createSettings = async (opts: SettingsOptions) => {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? console.warn;
  const saved: Partial<Record<SettingKey, unknown>> = {};
  let legacySaved: unknown;

  try {
    const parsed: unknown = JSON.parse(await fs.readFile(opts.file, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      legacySaved = (parsed as Record<string, unknown>).allowedTools;
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

  // The one list of tool names that earlier versions took (ALLOWED_TOOLS). When it is set it decides exactly which tools there are,
  // and both tool groups are shown as locked at what that list amounts to.
  const legacyTools = (): string[] | undefined => {
    const raw = nonEmpty(env.ALLOWED_TOOLS);
    return raw === undefined ? undefined : list(raw);
  };
  const isLevel = (key: SettingKey): key is "onDeviceTools" | "remoteTools" => {
    return key === "onDeviceTools" || key === "remoteTools";
  };
  const envValue = (key: SettingKey): string | undefined => {
    const raw = env[SETTING_ENV[key]];
    return key === "modelControl" || key === "claude" ? raw : nonEmpty(raw);
  };
  const isLocked = (key: SettingKey): boolean => {
    return (envValue(key) !== undefined && envValue(key) !== "") || (isLevel(key) && legacyTools() !== undefined);
  };
  // Which environment variable fixes a setting, for saying so.
  const lockedBy = (key: SettingKey): string => {
    return isLevel(key) && nonEmpty(env[SETTING_ENV[key]]) === undefined && legacyTools() !== undefined ? "ALLOWED_TOOLS" : SETTING_ENV[key];
  };

  // A list saved by an earlier version becomes the two levels it amounts to.
  if (Array.isArray(legacySaved) && legacySaved.every((n) => {
    return typeof n === "string";
  })) {
    const levels = accessOfTools(legacySaved);
    saved.onDeviceTools ??= levels.onDeviceTools;
    saved.remoteTools ??= levels.remoteTools;
  }

  const resolve = (): DeviceSettings => {
    const out: Record<string, unknown> = {};
    const legacy = legacyTools();
    for (const key of SETTING_KEYS) {
      const fixed = envValue(key);
      if (fixed !== undefined && fixed !== "") {
        out[key] = fromEnv(key, fixed);
      } else if (isLevel(key) && legacy !== undefined) {
        out[key] = accessOfTools(legacy)[key];
      } else {
        out[key] = saved[key] ?? DEFAULTS[key];
      }
    }
    return out as unknown as DeviceSettings;
  };

  // The tools to offer: the old list if one is set, otherwise what the two groups allow.
  const toolNames = (): string[] => {
    const now = resolve();
    return legacyTools() ?? toolNamesFor(now.onDeviceTools, now.remoteTools);
  };

  const report = (): SettingsReport => {
    const sources = {} as SettingsReport["sources"];
    for (const key of SETTING_KEYS) {
      sources[key] = isLocked(key) ? "env" : saved[key] === undefined ? "default" : "file";
    }
    const toolList = allTools.map((t) => {
      return { name: t.def.function.name, group: t.group, level: t.level, installed: t.requires === undefined || (opts.installed?.(t.requires) ?? true), asksFirst: t.needsApproval };
    });
    return { settings: resolve(), sources, locked: SETTING_KEYS.filter(isLocked), remoteConfig: opts.remoteConfig, tools: toolList };
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
    // The names of the tools to offer, for the tool server and the heartbeat.
    tools: toolNames,
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
      // A list of tool names, as earlier versions sent it, is taken as the two levels it amounts to.
      const entries = Object.entries(patch).flatMap(([name, value]): [string, unknown][] => {
        if (name !== "allowedTools" || !Array.isArray(value)) {
          return [[name, value]];
        }
        const levels = accessOfTools(value.filter((v): v is string => {
          return typeof v === "string" && findTool(v) !== undefined;
        }));
        return [["onDeviceTools", levels.onDeviceTools], ["remoteTools", levels.remoteTools]];
      });
      const accepted: [SettingKey, unknown][] = [];
      for (const [name, value] of entries) {
        const key = SETTING_KEYS.find((k) => {
          return k === name;
        });
        if (!key) {
          return refuse(`unknown setting "${name}"`);
        }
        if (isLocked(key)) {
          return refuse(`${key} is fixed by the ${lockedBy(key)} environment variable on this device`);
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
