// Loads each local model in turn and measures speed on a few coding prompts.
// Usage: pnpm bench [model ...]   (defaults to every downloaded LLM)
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const lms = path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");
const base = process.env.INFERENCE_URL ?? "http://localhost:1234";
const contextLength = Number(process.env.BENCH_CONTEXT ?? 32768);

const prompts = [
  { name: "function", text: "Write a TypeScript function `chunk<T>(items: T[], size: number): T[][]` that splits an array into chunks. Handle size <= 0 by throwing. Code only." },
  { name: "bugfix", text: "This function should return the median but is wrong. Fix it and explain the bug in one sentence.\n\nfunction median(a: number[]) { a.sort(); return a[Math.floor(a.length / 2)]; }" },
  { name: "refactor", text: "Refactor to remove the duplication, keep behaviour identical:\n\nfunction price(kind: string, qty: number) { if (kind === 'a') return qty * 10 * 1.2; if (kind === 'b') return qty * 15 * 1.2; if (kind === 'c') return qty * 20 * 1.2; return 0; }" },
];

interface Stats {
  tokens_per_second?: number;
  time_to_first_token?: number;
  generation_time?: number;
}

async function lmsRun(args: string[]): Promise<string> {
  const { stdout } = await run(lms, args, { timeout: 600_000 });
  return stdout.trim();
}

async function vramUsedMiB(): Promise<number | undefined> {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
    return Number(stdout.trim().split("\n")[0]);
  } catch {
    return undefined;
  }
}

async function listLlmKeys(): Promise<string[]> {
  const res = await fetch(`${base}/api/v0/models`);
  const body = (await res.json()) as { data: { id: string; type?: string }[] };
  return body.data.filter((m) => m.type !== "embeddings").map((m) => m.id);
}

async function ask(model: string, prompt: string) {
  const started = performance.now();
  const res = await fetch(`${base}/api/v0/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 700, temperature: 0 }),
    signal: AbortSignal.timeout(600_000),
  });
  const wall = (performance.now() - started) / 1000;
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { completion_tokens?: number };
    stats?: Stats;
  };
  return { text: body.choices[0]?.message.content ?? "", tokens: body.usage?.completion_tokens ?? 0, stats: body.stats ?? {}, wall };
}

async function main() {
  await lmsRun(["server", "start"]).catch(() => undefined);
  const models = process.argv.length > 2 ? process.argv.slice(2) : await listLlmKeys();
  await mkdir("bench-results", { recursive: true });
  const rows: string[][] = [];

  for (const model of models) {
    console.error(`\n== ${model}`);
    await lmsRun(["unload", "--all"]).catch(() => undefined);
    const t0 = performance.now();
    try {
      await lmsRun(["load", model, "-c", String(contextLength), "-y"]);
    } catch (err) {
      console.error(`load failed: ${(err as Error).message}`);
      rows.push([model, "load failed", "", "", "", ""]);
      continue;
    }
    const loadSec = (performance.now() - t0) / 1000;
    const vram = await vramUsedMiB();
    const speeds: number[] = [];
    const ttfts: number[] = [];
    let md = `# ${model} (context ${contextLength})\n`;

    for (const p of prompts) {
      const r = await ask(model, p.text);
      const tps = r.stats.tokens_per_second ?? (r.tokens && r.wall ? r.tokens / r.wall : 0);
      speeds.push(tps);
      if (r.stats.time_to_first_token !== undefined) ttfts.push(r.stats.time_to_first_token);
      console.error(`  ${p.name}: ${tps.toFixed(1)} tok/s, ${r.tokens} tokens, ${r.wall.toFixed(1)}s`);
      md += `\n## ${p.name}\n\n${tps.toFixed(1)} tok/s, ${r.tokens} tokens\n\n${r.text}\n`;
    }
    await writeFile(path.join("bench-results", `${model.replace(/[^\w.-]/g, "_")}.md`), md);

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    rows.push([
      model,
      `${loadSec.toFixed(0)}s`,
      vram ? `${(vram / 1024).toFixed(1)} GB` : "?",
      avg(speeds).toFixed(1),
      Number.isNaN(avg(ttfts)) ? "?" : `${avg(ttfts).toFixed(2)}s`,
      `${Math.min(...speeds).toFixed(1)}-${Math.max(...speeds).toFixed(1)}`,
    ]);
  }

  await lmsRun(["unload", "--all"]).catch(() => undefined);
  const header = ["MODEL", "LOAD", "VRAM", "AVG TOK/S", "AVG TTFT", "RANGE"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => x.padEnd(widths[i]!)).join("  ").trimEnd();
  console.log([line(header), ...rows.map(line)].join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
