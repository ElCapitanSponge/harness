import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// `tasklist /fo csv /nh` lines look like: "Game.exe","1234","Console","1","50,000 K"
export const parseTasklist = (stdout: string): Set<string> => {
  const names = stdout
    .split(/\r?\n/)
    .map((line) => {
      return line.split("\",\"")[0]?.replace(/"/g, "").trim().toLowerCase();
    })
    .filter((name): name is string => {
      return Boolean(name);
    });
  return new Set(names);
};

// `ps -A -o comm=` prints one command name per line (possibly with a path).
export const parsePs = (stdout: string): Set<string> => {
  const names = stdout
    .split(/\r?\n/)
    .map((line) => {
      return line.trim().split("/").pop()?.toLowerCase();
    })
    .filter((name): name is string => {
      return Boolean(name);
    });
  return new Set(names);
};

const runningProcesses = async (): Promise<Set<string>> => {
  if (process.platform === "win32") {
    const { stdout } = await run("tasklist", ["/fo", "csv", "/nh"], { maxBuffer: 16 * 1024 * 1024 });
    return parseTasklist(stdout);
  }
  const { stdout } = await run("ps", ["-A", "-o", "comm="], { maxBuffer: 16 * 1024 * 1024 });
  return parsePs(stdout);
};

// What the device is doing to others' use of it: busy (a game: leave it alone) or limited (a call: small models only). A game wins.
// The process list is read once for both.
export const detectLoad = async (
  gameProcesses: string[],
  limitedProcesses: string[],
  limitedMaxGb: number,
  list: () => Promise<Set<string>> = runningProcesses,
): Promise<{ busy: boolean; reason?: string; limit?: { reason: string; maxBytes: number } }> => {
  if (gameProcesses.length === 0 && limitedProcesses.length === 0) {
    return { busy: false };
  }
  try {
    const running = await list();
    const game = gameProcesses.find((p) => {
      return running.has(p.toLowerCase());
    });
    if (game) {
      return { busy: true, reason: `game running: ${game}` };
    }
    const call = limitedProcesses.find((p) => {
      return running.has(p.toLowerCase());
    });
    return call ? { busy: false, limit: { reason: `${call.replace(/\.exe$/i, "")} is running`, maxBytes: limitedMaxGb * 1e9 } } : { busy: false };
  } catch {
    return { busy: false };
  }
};

// If the process list cannot be read the node reports idle: failing busy would hide a working node forever.
export const detectBusy = async (
  gameProcesses: string[],
  list: () => Promise<Set<string>> = runningProcesses,
): Promise<{ busy: boolean; reason?: string }> => {
  if (gameProcesses.length === 0) {
    return { busy: false };
  }
  try {
    const running = await list();
    const hit = gameProcesses.find((p) => {
      return running.has(p.toLowerCase());
    });
    return hit ? { busy: true, reason: `game running: ${hit}` } : { busy: false };
  } catch {
    return { busy: false };
  }
};
