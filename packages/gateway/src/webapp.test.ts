import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWebDist, loadWebApp } from "./webapp.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-web-"));
  await fs.mkdir(path.join(dir, "assets"));
  await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>app</title>");
  await fs.writeFile(path.join(dir, "assets", "index-abc.js"), "console.log(1)");
  await fs.writeFile(path.join(dir, "secret.txt"), "no");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const build = async (): Promise<Hono> => {
  const app = new Hono();
  (await loadWebApp(dir))(app);
  return app;
};

describe("the built web app", () => {
  it("is found only where a build exists", async () => {
    expect(await findWebDist(dir)).toBe(dir);
    expect(await findWebDist(path.join(dir, "missing"))).toBeUndefined();
  });

  it("serves the page at its own addresses, never cached, under a strict policy", async () => {
    const app = await build();
    for (const url of ["/", "/c/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", "/manage/devices"]) {
      const res = await app.request(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(await res.text()).toContain("<title>app</title>");
    }
  });

  it("serves build assets for good, with the right type", async () => {
    const res = await (await build()).request("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("serves nothing outside the assets folder or of an unknown type", async () => {
    const app = await build();
    expect((await app.request("/assets/..%2Fsecret.txt")).status).toBe(404);
    expect((await app.request("/assets/secret.txt")).status).toBe(404);
    expect((await app.request("/assets/missing.js")).status).toBe(404);
  });
});
