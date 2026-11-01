// Loads each local model in turn and measures speed on a few coding prompts.
// Usage: pnpm bench [model ...]   (defaults to every downloaded LLM)
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import ts from "typescript";
import { Agent, fetch as slowFetch } from "undici";

const run = promisify(execFile);
// Slow models can take several minutes to answer; Node's default 5 minute headers timeout would abort them.
const patient = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const maxTokens = Number(process.env.BENCH_MAX_TOKENS ?? 4096);
const lms = path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");
const base = process.env.INFERENCE_URL ?? "http://localhost:1234";
const contextLength = Number(process.env.BENCH_CONTEXT ?? 32768);

// A function the model wrote, called by the checks with whatever arguments the prompt describes.
type Fn = (...args: unknown[]) => unknown;

const originalPrice = (kind: string, qty: number): number => {
  if (kind === "a") {
    return qty * 10 * 1.2;
  }
  if (kind === "b") {
    return qty * 15 * 1.2;
  }
  if (kind === "c") {
    return qty * 20 * 1.2;
  }
  return 0;
};

const same = (a: unknown, b: unknown) => {
  return JSON.stringify(a) === JSON.stringify(b);
};
const near = (a: unknown, b: number) => {
  return typeof a === "number" && Math.abs(a - b) < 1e-9;
};

// Each prompt names the function the model must define, and a check that runs it on test cases.
const prompts: { name: string; fn: string; text: string; check: (f: Fn) => boolean }[] = [
  {
    name: "function",
    fn: "chunk",
    text: "Write a TypeScript function `chunk<T>(items: T[], size: number): T[][]` that splits an array into chunks. Handle size <= 0 by throwing. Code only.",
    check: (f) => {
      let threw = 0;
      for (const s of [0, -1]) {
        try {
          f([1], s);
        } catch {
          threw++;
        }
      }
      return same(f([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]) && same(f([], 3), []) && same(f([1, 2], 5), [[1, 2]]) && threw === 2;
    },
  },
  {
    name: "bugfix",
    fn: "median",
    text: "This function should return the median but is wrong. Fix it, keep the name `median`, and explain the bug in one sentence.\n\nfunction median(a: number[]) { a.sort(); return a[Math.floor(a.length / 2)]; }",
    check: (f) => {
      return f([3, 1, 2]) === 2 && f([1, 2, 3, 4]) === 2.5 && f([10, 9, 1]) === 9 && f([7]) === 7;
    },
  },
  {
    name: "refactor",
    fn: "price",
    text: "Refactor to remove the duplication, keep the name `price` and the behaviour identical:\n\nfunction price(kind: string, qty: number) { if (kind === 'a') return qty * 10 * 1.2; if (kind === 'b') return qty * 15 * 1.2; if (kind === 'c') return qty * 20 * 1.2; return 0; }",
    check: (f) => {
      return [["a", 2], ["b", 3], ["c", 1], ["z", 5], ["a", 0], ["constructor", 4]].every(([k, q]) => {
        return near(f(k, q), originalPrice(k as string, q as number));
      });
    },
  },
];

// Pull the first code block that defines the function, compile it and return the function.
const loadFunction = (text: string, name: string): Fn | undefined => {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => {
    return m[1] ?? "";
  });
  const code = blocks.find((b) => {
    return new RegExp(`\\b${name}\\b`).test(b);
  });
  if (!code) {
    return undefined;
  }
  try {
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const ctx = vm.createContext({ exports: {}, module: { exports: {} } });
    vm.runInContext(`${js}\n;globalThis.__fn = ${name};`, ctx, { timeout: 2000 });
    return (ctx as { __fn?: Fn }).__fn;
  } catch {
    return undefined;
  }
};

const passes = (text: string, p: (typeof prompts)[number]): boolean => {
  const f = loadFunction(text, p.fn);
  if (!f) {
    return false;
  }
  try {
    return p.check(f);
  } catch {
    return false;
  }
};

interface Stats {
  tokens_per_second?: number;
  time_to_first_token?: number;
  generation_time?: number;
}

const lmsRun = async (args: string[]): Promise<string> => {
  const { stdout } = await run(lms, args, { timeout: 600_000 });
  return stdout.trim();
};

const vramUsedMiB = async (): Promise<number | undefined> => {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
    return Number(stdout.trim().split("\n")[0]);
  } catch {
    return undefined;
  }
};

const listLlmKeys = async (): Promise<string[]> => {
  const res = await fetch(`${base}/api/v0/models`);
  const body = (await res.json()) as { data: { id: string; type?: string }[] };
  return body.data.filter((m) => {
    return m.type !== "embeddings";
  }).map((m) => {
    return m.id;
  });
};

const ask = async (model: string, prompt: string) => {
  const started = performance.now();
  const res = await slowFetch(`${base}/api/v0/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
    dispatcher: patient,
    signal: AbortSignal.timeout(1_200_000),
  });
  const wall = (performance.now() - started) / 1000;
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { completion_tokens?: number };
    stats?: Stats;
  };
  return { text: body.choices[0]?.message.content ?? "", tokens: body.usage?.completion_tokens ?? 0, stats: body.stats ?? {}, wall };
};

const main = async () => {
  await lmsRun(["server", "start"]).catch(() => {
    return undefined;
  });
  const models = process.argv.length > 2 ? process.argv.slice(2) : await listLlmKeys();
  await mkdir("bench-results", { recursive: true });
  const rows: string[][] = [];

  for (const model of models) {
    console.error(`\n== ${model}`);
    await lmsRun(["unload", "--all"]).catch(() => {
      return undefined;
    });
    const t0 = performance.now();
    try {
      await lmsRun(["load", model, "-c", String(contextLength), "-y"]);
    } catch (err) {
      console.error(`load failed: ${(err as Error).message}`);
      rows.push([model, "load failed", "", "", "", "", ""]);
      continue;
    }
    const loadSec = (performance.now() - t0) / 1000;
    const vram = await vramUsedMiB();
    const speeds: number[] = [];
    const ttfts: number[] = [];
    let md = `# ${model} (context ${contextLength}, max tokens ${maxTokens})\n`;
    let passed = 0;

    for (const p of prompts) {
      const r = await ask(model, p.text);
      const tps = r.stats.tokens_per_second ?? (r.tokens && r.wall ? r.tokens / r.wall : 0);
      const ok = passes(r.text, p);
      if (ok) {
        passed++;
      }
      speeds.push(tps);
      if (r.stats.time_to_first_token !== undefined) {
        ttfts.push(r.stats.time_to_first_token);
      }
      console.error(`  ${p.name}: ${ok ? "PASS" : "FAIL"}, ${tps.toFixed(1)} tok/s, ${r.tokens} tokens, ${r.wall.toFixed(1)}s`);
      md += `\n## ${p.name} (${ok ? "pass" : "fail"})\n\n${tps.toFixed(1)} tok/s, ${r.tokens} tokens\n\n${r.text}\n`;
    }
    await writeFile(path.join("bench-results", `${model.replace(/[^\w.-]/g, "_")}.md`), md);

    const avg = (xs: number[]) => {
      return (xs.length
        ? xs.reduce((a, b) => {
          return a + b;
        }, 0) / xs.length
        : NaN);
    };
    rows.push([
      model,
      `${loadSec.toFixed(0)}s`,
      vram ? `${(vram / 1024).toFixed(1)} GB` : "?",
      avg(speeds).toFixed(1),
      Number.isNaN(avg(ttfts)) ? "?" : `${avg(ttfts).toFixed(2)}s`,
      `${Math.min(...speeds).toFixed(1)}-${Math.max(...speeds).toFixed(1)}`,
      `${passed}/${prompts.length}`,
    ]);
  }

  await lmsRun(["unload", "--all"]).catch(() => {
    return undefined;
  });
  const header = ["MODEL", "LOAD", "VRAM", "AVG TOK/S", "AVG TTFT", "RANGE", "PASSED"];
  const widths = header.map((h, i) => {
    return Math.max(h.length, ...rows.map((r) => {
      return r[i]?.length ?? 0;
    }));
  });
  const line = (c: string[]) => {
    return c.map((x, i) => {
      return x.padEnd(widths[i] ?? 0);
    }).join("  ").trimEnd();
  };
  console.log([line(header), ...rows.map(line)].join("\n"));
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
