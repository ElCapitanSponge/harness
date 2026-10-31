import { describe, expect, it } from "vitest";
import { ChatRequest, Heartbeat, authHeaders } from "./index.js";

describe("authHeaders", () => {
  it("builds a bearer header when a key is set", () => {
    expect(authHeaders("k")).toEqual({ authorization: "Bearer k" });
  });

  it("returns no headers without a key", () => {
    expect(authHeaders()).toEqual({});
    expect(authHeaders("")).toEqual({});
  });
});

describe("ChatRequest", () => {
  it("accepts a minimal request", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [{ role: "user", content: "hi" }] }).success).toBe(true);
  });

  it("rejects an empty messages array", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [] }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [{ role: "robot", content: "hi" }] }).success).toBe(false);
  });
});

describe("Heartbeat", () => {
  const valid = { nodeId: "pc", kind: "local", baseUrl: "http://localhost:1234", busy: false, models: [{ id: "qwen", loaded: true }] };

  it("accepts a valid heartbeat", () => {
    expect(Heartbeat.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-URL baseUrl", () => {
    expect(Heartbeat.safeParse({ ...valid, baseUrl: "not a url" }).success).toBe(false);
  });

  it("rejects an unknown node kind", () => {
    expect(Heartbeat.safeParse({ ...valid, kind: "cloud" }).success).toBe(false);
  });
});
