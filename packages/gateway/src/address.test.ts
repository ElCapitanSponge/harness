import { describe, expect, it } from "vitest";
import { callerAddress, looksLikeContainerNetwork, normalizeAddress } from "./address.js";

describe("addresses", () => {
  it("reads the same address in one form, and every loopback address as the same one", () => {
    expect(normalizeAddress("::ffff:100.64.0.7")).toBe("100.64.0.7");
    expect(normalizeAddress("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeAddress("127.0.0.1")).toBe("loopback");
    expect(normalizeAddress("::1")).toBe("loopback");
    expect(normalizeAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(normalizeAddress("192.168.1.20")).toBe("192.168.1.20");
    expect(normalizeAddress(undefined)).toBeUndefined();
  });

  it("recognises the range containers get from the runtime", () => {
    expect(looksLikeContainerNetwork("172.17.0.1")).toBe(true);
    expect(looksLikeContainerNetwork("172.31.5.5")).toBe(true);
    expect(looksLikeContainerNetwork("172.32.0.1")).toBe(false);
    expect(looksLikeContainerNetwork("100.64.0.7")).toBe(false);
    expect(looksLikeContainerNetwork(undefined)).toBe(false);
  });

  it("believes X-Forwarded-For only when told a proxy is in front", () => {
    expect(callerAddress("172.17.0.1", "100.64.0.9, 10.0.0.1", true)).toBe("100.64.0.9");
    expect(callerAddress("172.17.0.1", "100.64.0.9", false)).toBe("172.17.0.1");
    expect(callerAddress("::ffff:100.64.0.7", undefined, true)).toBe("100.64.0.7");
  });
});
