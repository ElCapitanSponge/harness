import { beforeEach, describe, expect, it } from "vitest";
import { RECENT_KEY, guideFor, pushRecent, readRecent, resolveThisDevice } from "./thisdevice";
import type { NodeRecord } from "./types";

const node = (nodeId: string): NodeRecord => {
  return { nodeId, kind: "local", busy: false, models: [], lastSeen: 0 };
};

describe("which device this is", () => {
  const nodes = [node("anakin"), node("bastila")];

  it("takes the gateway match when the person has not said", () => {
    expect(resolveThisDevice(["anakin"], undefined, nodes)).toEqual({ state: "device", nodeId: "anakin" });
  });

  it("takes the person's choice over the gateway match", () => {
    expect(resolveThisDevice(["anakin"], "bastila", nodes)).toEqual({ state: "device", nodeId: "bastila" });
  });

  it("is none when the person says there is no agent here, and unknown when nothing matches", () => {
    expect(resolveThisDevice(["anakin"], "none", nodes)).toEqual({ state: "none" });
    expect(resolveThisDevice([], undefined, nodes)).toEqual({ state: "unknown" });
  });

  it("does not use a device that is no longer connected", () => {
    expect(resolveThisDevice(["gone"], undefined, nodes)).toEqual({ state: "unknown" });
    expect(resolveThisDevice(["anakin"], "gone", nodes)).toEqual({ state: "device", nodeId: "anakin" });
  });
});

describe("setup guides", () => {
  it("point at the guide for the operating system of the browser", () => {
    expect(guideFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toMatchObject({ os: "Windows", href: expect.stringContaining("windows.md") as string });
    expect(guideFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toMatchObject({ os: "macOS" });
    expect(guideFor("Mozilla/5.0 (X11; Linux x86_64)")).toMatchObject({ os: "Linux" });
  });
});

describe("recent folders", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the last five, newest first, without repeating one", () => {
    for (const root of ["a", "b", "c", "d", "e", "f"]) {
      pushRecent({ device: "anakin", root });
    }
    pushRecent({ device: "anakin", root: "d" });
    expect(readRecent().map((r) => {
      return r.root;
    })).toEqual(["d", "f", "e", "c", "b"]);
  });

  it("ignores stored text that is not a list of folders", () => {
    localStorage.setItem(RECENT_KEY, "{broken");
    expect(readRecent()).toEqual([]);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ device: 1 }, { device: "a", root: "b" }]));
    expect(readRecent()).toEqual([{ device: "a", root: "b" }]);
  });
});
