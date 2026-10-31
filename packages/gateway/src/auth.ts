import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bearerAuth(key: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(token, key)) return c.json({ error: { message: "unauthorized" } }, 401);
    await next();
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD = new Set(["0.0.0.0", "::"]);

// Fail closed: a network-facing listener needs a key. Wildcard binds are only for containers, where the
// published port (bound to the Tailscale address on the host) is what limits exposure, and need an explicit opt-in.
export function assertSafeBinding(hosts: string[], apiKey: string | undefined, allowAnyInterface = false): void {
  for (const host of hosts) {
    if (WILDCARD.has(host) && !allowAnyInterface) {
      throw new Error(`refusing to listen on wildcard address ${host}; list explicit addresses (or set HARNESS_ALLOW_ANY_INTERFACE=1 inside a container)`);
    }
    if (!LOOPBACK.has(host) && !apiKey) throw new Error(`refusing to listen on ${host} without HARNESS_API_KEY set`);
  }
}
