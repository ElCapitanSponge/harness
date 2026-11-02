import { describe, expect, it } from "vitest";
import { nested } from "./tree";
import type { SessionInfo } from "./types";

const info = (id: string, parent?: string): SessionInfo => {
  return { id, model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: id, deviceConnected: true, ...(parent ? { parent } : {}) };
};

describe("nesting sub-agent conversations", () => {
  it("lists each under its parent, one step in, keeping the order given", () => {
    const list = [info("a"), info("a1", "a"), info("b"), info("a1x", "a1"), info("a2", "a")];
    expect(nested(list).map((n) => {
      return `${String(n.indent)}:${n.info.id}`;
    })).toEqual(["0:a", "1:a1", "2:a1x", "1:a2", "0:b"]);
  });

  it("lists a sub-agent whose parent is gone on its own", () => {
    expect(nested([info("orphan", "missing")]).map((n) => {
      return n.indent;
    })).toEqual([0]);
  });
});
