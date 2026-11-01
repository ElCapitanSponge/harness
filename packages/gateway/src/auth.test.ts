import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { assertSafeBinding, bearerAuth, safeEqual } from "./auth.js";

const app = new Hono();
app.use("*", bearerAuth("s3cret"));
app.get("/ping", (c) => {
  return c.text("pong");
});

const call = (headers: Record<string, string> = {}) => {
  return app.request("/ping", { headers });
};

describe("bearerAuth", () => {
  it("allows the right key", async () => {
    const res = await call({ authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("rejects a missing header", async () => {
    expect((await call()).status).toBe(401);
  });

  it("rejects a wrong key and a wrong scheme", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await call({ authorization: "Basic s3cret" })).status).toBe(401);
    expect((await call({ authorization: "s3cret" })).status).toBe(401);
  });
});

describe("safeEqual", () => {
  it("compares strings of equal and different length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("assertSafeBinding", () => {
  it("allows loopback without a key", () => {
    expect(() => {
      assertSafeBinding(["127.0.0.1", "::1", "localhost"], undefined);
    }).not.toThrow();
  });

  it("refuses a network address without a key", () => {
    expect(() => {
      assertSafeBinding(["100.64.0.5"], undefined);
    }).toThrow("HARNESS_API_KEY");
  });

  it("allows a network address when a key is set", () => {
    expect(() => {
      assertSafeBinding(["127.0.0.1", "100.64.0.5"], "k");
    }).not.toThrow();
  });

  it("refuses wildcard addresses unless explicitly allowed, even with a key", () => {
    expect(() => {
      assertSafeBinding(["0.0.0.0"], "k");
    }).toThrow("wildcard");
    expect(() => {
      assertSafeBinding(["::"], "k");
    }).toThrow("wildcard");
  });

  it("allows a wildcard address only with both the opt-in and a key", () => {
    expect(() => {
      assertSafeBinding(["0.0.0.0"], "k", true);
    }).not.toThrow();
    expect(() => {
      assertSafeBinding(["0.0.0.0"], undefined, true);
    }).toThrow("HARNESS_API_KEY");
  });
});
