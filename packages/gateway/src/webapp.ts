import fs from "node:fs/promises";
import path from "node:path";
import type { Context, Hono } from "hono";

// Serves the built web app (packages/web) from a folder. The files hold no secrets and must load before a key can be
// typed, so these routes are registered ahead of the auth middleware. Anything under /assets is a hashed build output
// and is cached for good; the page itself is never cached, so a new build shows at once.

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// File names a build produces: letters, digits, dots, dashes and underscores. Nothing else reaches the file system.
const SAFE_NAME = /^[\w.-]+$/;

// The folder holding a build, if one exists.
export const findWebDist = async (dir: string): Promise<string | undefined> => {
  try {
    await fs.access(path.join(dir, "index.html"));
    return dir;
  } catch {
    return undefined;
  }
};

// Reads the build and returns what mounts it on an app.
export const loadWebApp = async (dist: string): Promise<(app: Hono) => void> => {
  const index = await fs.readFile(path.join(dist, "index.html"), "utf8");
  return (app) => {
    mount(app, dist, index);
  };
};

const mount = (app: Hono, dist: string, index: string): void => {
  const page = (c: Context) => {
    return c.html(index, 200, PAGE_HEADERS);
  };

  app.get("/", page);
  // The app's own addresses. Everything else under these is the app's router, never an API.
  app.get("/c/:id", page);
  app.get("/manage/:section", page);

  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    const type = TYPES[path.extname(name)];
    if (!SAFE_NAME.test(name) || !type) {
      return c.notFound();
    }
    try {
      const body = await fs.readFile(path.join(dist, "assets", name));
      return new Response(new Uint8Array(body), {
        headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    } catch {
      return c.notFound();
    }
  });
};
