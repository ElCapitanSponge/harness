import { describe, expect, it } from "vitest";
import { groupSessions } from "./groups";
import type { SessionInfo } from "./types";

const code = (id: string, device: string, root: string, parent?: string): SessionInfo => {
  return { id, model: "m", device, root, busy: false, events: 0, created: 0, updated: 0, kind: "code", title: id, deviceConnected: true, ...(parent ? { parent } : {}) };
};
const chat = (id: string): SessionInfo => {
  return { id, model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: id, deviceConnected: true };
};

describe("grouping conversations by project", () => {
  it("makes one group for each folder on each device, in the order they first appear, and puts chats last", () => {
    const groups = groupSessions([chat("c1"), code("a", "pc", "C:/work/app"), code("b", "mac", "/Users/me/app"), code("c", "pc", "C:/work/app")], "pc");
    expect(groups.map((g) => {
      return `${g.name}@${g.device}:${g.items.map((i) => {
        return i.info.id;
      }).join(",")}`;
    })).toEqual(["app@pc:a,c", "app@mac:b", "Chats@:c1"]);
  });

  it("marks the groups on this device, never the chats", () => {
    const groups = groupSessions([code("a", "pc", "p"), code("b", "mac", "p"), chat("c")], "pc");
    expect(groups.map((g) => {
      return g.here;
    })).toEqual([true, false, false]);
  });

  it("marks nothing as here when the device is not known", () => {
    expect(groupSessions([code("a", "pc", "p")], undefined)[0]?.here).toBe(false);
  });

  it("keeps a sub-agent's conversation under its parent in the group", () => {
    const [group] = groupSessions([code("a", "pc", "p"), code("a1", "pc", "p", "a")], "pc");
    expect(group?.items.map((i) => {
      return `${String(i.indent)}:${i.info.id}`;
    })).toEqual(["0:a", "1:a1"]);
  });

  it("makes no group when there are no conversations", () => {
    expect(groupSessions([], "pc")).toEqual([]);
  });
});
