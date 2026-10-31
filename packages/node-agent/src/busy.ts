import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// `tasklist /fo csv /nh` lines look like: "Game.exe","1234","Console","1","50,000 K"
export function parseTasklist(stdout: string): Set<string> {
  const names = stdout
    .split(/\r?\n/)
    .map((line) => line.split('","')[0]?.replace(/"/g, "").trim().toLowerCase())
    .filter((name): name is string => Boolean(name));
  return new Set(names);
}

// `ps -A -o comm=` prints one command name per line (possibly with a path).
export function parsePs(stdout: string): Set<string> {
  const names = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split("/").pop()?.toLowerCase())
    .filter((name): name is string => Boolean(name));
  return new Set(names);
}

async function runningProcesses(): Promise<Set<string>> {
  if (process.platform === "win32") {
    const { stdout } = await run("tasklist", ["/fo", "csv", "/nh"], { maxBuffer: 16 * 1024 * 1024 });
    return parseTasklist(stdout);
  }
  const { stdout } = await run("ps", ["-A", "-o", "comm="], { maxBuffer: 16 * 1024 * 1024 });
  return parsePs(stdout);
}

// If the process list cannot be read the node reports idle: failing busy would hide a working node forever.
export async function detectBusy(
  gameProcesses: string[],
  list: () => Promise<Set<string>> = runningProcesses,
): Promise<{ busy: boolean; reason?: string }> {
  if (gameProcesses.length === 0) return { busy: false };
  try {
    const running = await list();
    const hit = gameProcesses.find((p) => running.has(p.toLowerCase()));
    return hit ? { busy: true, reason: `game running: ${hit}` } : { busy: false };
  } catch {
    return { busy: false };
  }
}
