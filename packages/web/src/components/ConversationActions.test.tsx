import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

const info = (pinned?: boolean, archived?: boolean): SessionInfo => {
  return { id: "s1", model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: "A chat", deviceConnected: true, ...(pinned ? { pinned } : {}), ...(archived ? { archived } : {}) };
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

describe("deleting from a conversation's menu", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({});
  });

  it("asks first, and deletes nothing if the answer is no", async () => {
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(screen.getByRole("alertdialog", { name: "Delete this conversation?" })).toHaveAccessibleDescription(/cannot be brought back/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api).not.toHaveBeenCalledWith("/sessions/s1", { method: "DELETE" });
  });

  it("deletes the conversation once the person confirms, and closes the question", async () => {
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "DELETE" });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("keeps the question open and shows the reason when the delete fails", async () => {
    api.mockRejectedValue(new Error("The gateway said no"));
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The gateway said no");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("archiving from a conversation's menu", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({});
  });

  it("offers Archive, and archives the conversation", async () => {
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /^Archive$/ }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "PATCH", body: { archived: true } });
  });

  it("offers Unarchive for an archived conversation, and no Pin", async () => {
    await open(info(false, true));
    expect(screen.queryByRole("menuitem", { name: /Pin to top|Unpin/ })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: /Unarchive/ }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "PATCH", body: { archived: false } });
  });

  it("offers Archive instead in the delete question, and puts the conversation away without deleting it", async () => {
    await open(info());
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    expect(api).toHaveBeenCalledWith("/sessions/s1", { method: "PATCH", body: { archived: true } });
    expect(api).not.toHaveBeenCalledWith("/sessions/s1", { method: "DELETE" });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("does not offer Archive instead for a conversation that is already archived", async () => {
    await open(info(false, true));
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });
});
