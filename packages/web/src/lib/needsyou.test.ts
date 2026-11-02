import { describe, expect, it } from "vitest";
import { iconWithDot, newlyNeeding, needingYou, notificationFor, titleFor } from "./needsyou";
import type { SessionInfo } from "./types";

const info = (id: string, waiting?: "approval" | "question"): SessionInfo => {
  return { id, model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: `T ${id}`, deviceConnected: true, ...(waiting ? { waiting } : {}) };
};

describe("telling the person which conversations need them", () => {
  it("counts the conversations that are waiting, whichever one is open", () => {
    expect(needingYou([info("a"), info("b", "approval"), info("c", "question")]).map((s) => {
      return s.id;
    })).toEqual(["b", "c"]);
  });

  it("announces a conversation once, when it starts to need the person", () => {
    const list = [info("a", "approval"), info("b", "question")];
    expect(newlyNeeding(new Set(["a"]), list).map((s) => {
      return s.id;
    })).toEqual(["b"]);
    expect(newlyNeeding(new Set(["a", "b"]), list)).toEqual([]);
    expect(newlyNeeding(new Set(), [info("a")])).toEqual([]);
  });

  it("puts the count in the tab title only when there is one", () => {
    expect(titleFor(0)).toBe("Torii");
    expect(titleFor(3)).toBe("(3) Torii");
  });

  it("words a notification by what is needed, with the conversation's title", () => {
    expect(notificationFor(info("a", "question"))).toEqual({ title: "Torii: a question for you", body: "T a", tag: "needs-you-a" });
    expect(notificationFor(info("b", "approval")).title).toBe("Torii: approval needed");
    expect(notificationFor({ ...info("c", "approval"), title: "" }).body).toBe("A conversation needs you");
  });

  it("adds a dot to the tab icon, and leaves an icon it cannot draw on alone", () => {
    const plain = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>")}`;
    expect(decodeURIComponent(iconWithDot(plain))).toContain("<circle");
    expect(iconWithDot("/favicon.png")).toBe("/favicon.png");
  });
});
