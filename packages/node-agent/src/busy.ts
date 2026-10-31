import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function runningProcesses(): Promise<Set<string>> {
  if (process.platform === "win32") {
    const { stdout } = await run("tasklist", ["/fo", "csv", "/nh"]);
    return new Set(stdout.split("\n").map((l) => l.split('","')[0]?.replace(/"/g, "").toLowerCase()).filter(Boolean) as string[]);
  }
  const { stdout } = await run("ps", ["-A", "-o", "comm="]);
  return new Set(stdout.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean));
}

export async function detectBusy(gameProcesses: string[]): Promise<{ busy: boolean; reason?: string }> {
  try {
    const running = await runningProcesses();
    const hit = gameProcesses.find((p) => running.has(p));
    return hit ? { busy: true, reason: `game running: ${hit}` } : { busy: false };
  } catch {
    return { busy: false };
  }
}
