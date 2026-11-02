import { rootNameFor } from "./desktop";
import type { NodeRecord, SettingsReport } from "./types";

// Making a folder chosen with the system picker into a project folder on this machine, the way the Devices page would: it is added to
// the device's project folders (so read-only folders and tool levels still apply), and we wait until the device lists it.

export interface AddFolderDeps {
  settings: (nodeId: string) => Promise<SettingsReport>;
  save: (nodeId: string, projectRoots: Record<string, string>) => Promise<unknown>;
  nodes: () => Promise<NodeRecord[]>;
  // Waits between looks at the device list (replaced in tests).
  pause?: (ms: number) => Promise<void>;
  // How long to wait for the device to list the folder, in milliseconds.
  waitMs?: number;
}

export type AddedFolder = { ok: true; root: string; added: boolean } | { ok: false; error: string };

// The same folder however it is written: slashes, a trailing slash and (on Windows paths) letter case do not matter.
const sameFolder = (a: string, b: string): boolean => {
  const norm = (p: string): string => {
    const slashed = p.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
};

const uniqueName = (wanted: string, taken: string[]): string => {
  let name = wanted;
  for (let n = 2; taken.includes(name); n++) {
    name = `${wanted}-${String(n)}`;
  }
  return name;
};

const defaultPause = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const addProjectFolder = async (nodeId: string, folder: string, deps: AddFolderDeps): Promise<AddedFolder> => {
  const pause = deps.pause ?? defaultPause;
  let report: SettingsReport;
  try {
    report = await deps.settings(nodeId);
  } catch (err) {
    return { ok: false, error: `Could not read this device's settings: ${err instanceof Error ? err.message : "unknown error"}` };
  }
  const current = report.settings.projectRoots;
  const existing = Object.entries(current).find(([, dir]) => {
    return sameFolder(dir, folder);
  });
  if (existing) {
    return { ok: true, root: existing[0], added: false };
  }
  if (!report.remoteConfig || report.locked.includes("projectRoots")) {
    return { ok: false, error: "This device's project folders are fixed where the agent is started (PROJECT_ROOTS), so a folder cannot be added from here." };
  }
  const name = uniqueName(rootNameFor(folder), Object.keys(current));
  try {
    await deps.save(nodeId, { ...current, [name]: folder });
  } catch (err) {
    return { ok: false, error: `The device would not accept the folder: ${err instanceof Error ? err.message : "unknown error"}` };
  }
  const deadline = deps.waitMs ?? 15_000;
  for (let waited = 0; waited <= deadline; waited += 1000) {
    const listed = (await deps.nodes().catch(() => {
      return [] as NodeRecord[];
    })).find((n) => {
      return n.nodeId === nodeId;
    });
    if (listed?.roots?.includes(name)) {
      return { ok: true, root: name, added: true };
    }
    await pause(1000);
  }
  // Never leave a folder half-added: put the device's folders back as they were.
  await deps.save(nodeId, current).catch(() => {
    return undefined;
  });
  return { ok: false, error: "The device did not list the folder in time, so it was not added. Check that the agent is running and try again." };
};
