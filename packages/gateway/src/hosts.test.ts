import { describe, expect, it, vi } from "vitest";
import { resolveHosts } from "./hosts.js";

describe("resolveHosts", () => {
  it("passes plain addresses through and trims whitespace", async () => {
    expect(await resolveHosts(" 127.0.0.1 , 10.0.0.2 ")).toEqual(["127.0.0.1", "10.0.0.2"]);
  });

  it("replaces 'tailscale' with the looked-up address", async () => {
    expect(await resolveHosts("127.0.0.1,tailscale", async () => "100.64.0.9")).toEqual(["127.0.0.1", "100.64.0.9"]);
  });

  it("skips 'tailscale' with a warning when it is not connected", async () => {
    const warn = vi.fn();
    const down = async () => {
      throw new Error("unexpected state: NoState\nmore");
    };
    expect(await resolveHosts("127.0.0.1,tailscale", down, warn)).toEqual(["127.0.0.1"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NoState"));
  });

  it("removes duplicates", async () => {
    expect(await resolveHosts("127.0.0.1,127.0.0.1")).toEqual(["127.0.0.1"]);
  });

  it("throws when nothing usable is left", async () => {
    const down = async () => {
      throw new Error("down");
    };
    await expect(resolveHosts("tailscale", down, () => undefined)).rejects.toThrow("no usable listen address");
  });
});
