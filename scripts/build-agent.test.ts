import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgent } from "./build-agent.js";

let dir: string;
let bundle: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-bundle-"));
  bundle = path.join(dir, "agent.mjs");
  await buildAgent(bundle);
}, 60_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("the agent bundle", () => {
  it("is a single file that plain node runs, and the agent starts from it", async () => {
    // The bundle sits outside the repository here, so the one package left outside it (Playwright) is not looked for until a page is opened.
    const child = spawn(process.execPath, ["--max-semi-space-size=1", bundle], {
      env: { ...process.env, NODE_ID: "bundle-test", GATEWAY_URL: "http://127.0.0.1:9", HARNESS_API_KEY: "", SETTINGS_FILE: path.join(dir, "settings.json"), AUDIT_LOG: path.join(dir, "audit.log") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`the agent did not start; it printed: ${out}`));
      }, 15_000);
      const take = (d: Buffer): void => {
        out += d.toString("utf8");
        if (out.includes("[agent] bundle-test ->")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`the agent exited with ${String(code)}: ${out}`));
      });
    });
    try {
      await started;
      expect(out).toContain("http://127.0.0.1:9");
    } finally {
      child.kill();
    }
  }, 30_000);

  it("keeps the browser's Playwright outside the bundle, so it is only loaded when a page is opened", async () => {
    const text = await fs.readFile(bundle, "utf8");
    expect(text).toContain("import(\"playwright-core\")");
    expect(text).not.toMatch(/^import .* from "playwright-core"/m);
    expect(text.length).toBeLessThan(5_000_000);
  });
});
