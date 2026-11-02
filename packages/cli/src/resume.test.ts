import type { SessionInfo } from "@harness/core";
import { describe, expect, it } from "vitest";
import { pickSession } from "./resume";

const s = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => {
  return { id, model: "m", device: "pc", root: "proj", busy: false, events: 3, created: 0, updated: 1, kind: "code", title: "", deviceConnected: true, ...over };
};

describe("picking the session to go back to", () => {
  const all = [s("aaaa1111", { updated: 5 }), s("aaaa2222", { updated: 9 }), s("bbbb3333", { updated: 7, root: "other" }), s("cccc4444", { kind: "chat", updated: 99 })];

  it("takes the newest coding session, in the device and root if given", () => {
    expect(pickSession(all, { continue: true }).id).toBe("aaaa2222");
    expect(pickSession(all, { continue: true, root: "other" }).id).toBe("bbbb3333");
    expect(() => {
      return pickSession(all, { continue: true, device: "mac" });
    }).toThrow("no coding session to continue");
  });

  it("takes an id or the start of one, never a chat", () => {
    expect(pickSession(all, { resume: "bbbb" }).id).toBe("bbbb3333");
    expect(pickSession(all, { resume: "aaaa2" }).id).toBe("aaaa2222");
    expect(() => {
      return pickSession(all, { resume: "cccc" });
    }).toThrow("no coding session starts with");
    expect(() => {
      return pickSession(all, { resume: "aaaa" });
    }).toThrow("fits 2 sessions");
  });
});
