import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@/lib/types";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  return { api: (path: string, init?: unknown) => {
    return api(path, init) as Promise<unknown>;
  } };
});

const { ConversationActions } = await import("./ConversationActions");

const info = (pinned?: boolean): SessionInfo => {
  return { id: "s1", model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: "A chat", deviceConnected: true, ...(pinned ? { pinned } : {}) };
};

const open = async (session: SessionInfo) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationActions info={session} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Conversation actions" }));
};

describe("pinning from a conversation's menu", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({});
  });

  it("offers Pin to top for a conversation that is not pinned, and pins it", async () => {
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /Pin to top/ }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "PATCH", body: { pinned: true } });
  });

  it("offers Unpin for a pinned conversation, and unpins it", async () => {
    await open(info(true));
    await userEvent.click(screen.getByRole("menuitem", { name: /Unpin/ }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "PATCH", body: { pinned: false } });
  });
});
