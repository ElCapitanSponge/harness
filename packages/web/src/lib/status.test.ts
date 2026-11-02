import { describe, expect, it } from "vitest";
import { statusLabel, statusOf } from "./status";
import type { SessionInfo } from "./types";

const info = (over: Partial<SessionInfo> = {}): SessionInfo => {
  return { id: "a", model: "m", device: "", root: "", busy: false, events: 4, created: 0, updated: 0, kind: "chat", title: "t", deviceConnected: true, ...over };
};

describe("what a conversation in the sidebar is doing", () => {
  it("shows nothing for a conversation that is read and idle, or whose read position is not known", () => {
    expect(statusOf(info({ read: 4 }), false)).toBeUndefined();
    expect(statusOf(info(), false)).toBeUndefined();
  });

  it("shows working while a turn runs", () => {
    expect(statusOf(info({ busy: true, read: 4 }), false)).toBe("working");
  });

  it("shows needs-you while waiting, over working and unread", () => {
    expect(statusOf(info({ busy: true, waiting: "approval", read: 0 }), false)).toBe("needs-you");
  });

  it("shows unread when there are events not read yet", () => {
    expect(statusOf(info({ read: 2 }), false)).toBe("unread");
  });

  it("does not mark the conversation in front of the person as unread, but still says it is working or waiting", () => {
    expect(statusOf(info({ read: 0 }), true)).toBeUndefined();
    expect(statusOf(info({ busy: true, read: 0 }), true)).toBe("working");
    expect(statusOf(info({ waiting: "question", read: 0 }), true)).toBe("needs-you");
  });

  it("describes each in words, and says whether it is an approval or a question", () => {
    expect(statusLabel("working", info())).toBe("Working");
    expect(statusLabel("unread", info())).toBe("Has new messages");
    expect(statusLabel("needs-you", info({ waiting: "approval" }))).toBe("Waiting for your approval");
    expect(statusLabel("needs-you", info({ waiting: "question" }))).toBe("Waiting for your answer");
  });
});
