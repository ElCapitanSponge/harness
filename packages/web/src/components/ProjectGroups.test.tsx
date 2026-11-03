import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ARCHIVE_ENTRY, groupSessions } from "@/lib/groups";
import type { SessionInfo } from "@/lib/types";
import { collapsedKeys, ProjectGroups } from "./ProjectGroups";

const code = (id: string, device: string, root: string): SessionInfo => {
  return { id, model: "m", device, root, busy: false, events: 0, created: 0, updated: 0, kind: "code", title: `Title ${id}`, deviceConnected: true };
};
const chat: SessionInfo = { id: "c", model: "m", device: "", root: "", busy: false, events: 0, created: 0, updated: 0, kind: "chat", title: "A chat", deviceConnected: true };

const list = [code("a", "anakin", "C:/work/app"), code("b", "bastila", "/home/me/app"), chat];

// The button that collapses and expands the group whose device label is given.
const header = (label: string): HTMLElement => {
  const button = screen.getByText(label).closest("button");
  if (!button) {
    throw new Error(`no group header for ${label}`);
  }
  return button;
};

const show = (collapsed: { device: string; root: string }[] = []) => {
  const onToggle = vi.fn();
  const onNew = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectGroups groups={groupSessions(list, "anakin")} collapsed={collapsedKeys(collapsed)} pathname="/" onToggle={onToggle} onNew={onNew} onNavigate={vi.fn()} onDeleted={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onToggle, onNew };
};

describe("the sidebar's project groups", () => {
  it("shows each project by folder name with this device or the other device's name, and chats apart", () => {
    show();
    expect(screen.getByText("This device")).toBeVisible();
    expect(screen.getByText("bastila")).toBeVisible();
    expect(screen.getByText("Chats")).toBeVisible();
    expect(screen.getByText("Title a")).toBeVisible();
    expect(screen.getByText("A chat")).toBeVisible();
  });

  it("hides the conversations of a collapsed group and says it is collapsed", () => {
    show([{ device: "anakin", root: "C:/work/app" }]);
    expect(screen.queryByText("Title a")).toBeNull();
    expect(screen.getByText("Title b")).toBeVisible();
    expect(header("This device")).toHaveAttribute("aria-expanded", "false");
    expect(header("bastila")).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses the Chats group when the stored list has it, which has no device or folder", () => {
    show([{ device: "", root: "" }]);
    expect(screen.queryByText("A chat")).toBeNull();
    expect(screen.getByText("Title a")).toBeVisible();
    expect(header("Chats")).toHaveAttribute("aria-expanded", "false");
  });

  it("asks to collapse a group that is open", async () => {
    const { onToggle } = show();
    await userEvent.click(header("This device"));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ device: "anakin", root: "C:/work/app" }), true);
  });

  it("asks to expand a group that is collapsed", async () => {
    const { onToggle } = show([{ device: "anakin", root: "C:/work/app" }]);
    await userEvent.click(header("This device"));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ device: "anakin" }), false);
  });

  it("starts a new session in a project, and offers none for chats", async () => {
    const { onNew } = show();
    expect(screen.getAllByRole("button", { name: /New session in/ })).toHaveLength(2);
    await userEvent.click(within(screen.getByRole("region", { name: "app on bastila" })).getByRole("button", { name: "New session in app" }));
    expect(onNew).toHaveBeenCalledWith(expect.objectContaining({ device: "bastila" }));
  });

  it("lists pinned conversations first under a Pinned heading, with the project they belong to", () => {
    const pinned = [{ ...code("a", "anakin", "C:/work/app"), pinned: true }, chat];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectGroups groups={groupSessions(pinned, "anakin")} collapsed={collapsedKeys([])} pathname="/" onToggle={vi.fn()} onNew={vi.fn()} onNavigate={vi.fn()} onDeleted={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const group = screen.getByRole("region", { name: "Pinned" });
    expect(within(group).getByText("Title a")).toBeVisible();
    expect(within(group).getByText(/app · anakin/)).toBeVisible();
    expect(within(group).queryByRole("button", { name: /New session in/ })).toBeNull();
  });

  it("marks a working conversation, a conversation waiting for the person, and one with unread messages, in words", () => {
    const list = [
      { ...code("a", "anakin", "C:/work/app"), busy: true, read: 0, events: 3 },
      { ...code("b", "anakin", "C:/work/app"), waiting: "approval" as const, read: 0, events: 3 },
      { ...code("c", "anakin", "C:/work/app"), read: 1, events: 3 },
      { ...code("d", "anakin", "C:/work/app"), read: 3, events: 3 },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectGroups groups={groupSessions(list, "anakin")} collapsed={collapsedKeys([])} pathname="/" onToggle={vi.fn()} onNew={vi.fn()} onNavigate={vi.fn()} onDeleted={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your approval")).toBeInTheDocument();
    expect(screen.getByText("Has new messages")).toBeInTheDocument();
    expect(screen.getAllByText(/Working|Waiting for|Has new messages/)).toHaveLength(3);
  });

  it("does not mark the open conversation as unread", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectGroups groups={groupSessions([{ ...code("a", "anakin", "p"), read: 0, events: 3 }], "anakin")} collapsed={collapsedKeys([])} pathname="/c/a" onToggle={vi.fn()} onNew={vi.fn()} onNavigate={vi.fn()} onDeleted={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Has new messages")).toBeNull();
  });

  const archivedList = [code("a", "anakin", "C:/work/app"), { ...code("b", "anakin", "C:/work/app"), archived: true }, { ...chat, id: "d", title: "Old chat", archived: true }];
  const mountArchive = (items: SessionInfo[], opened: boolean) => {
    const onToggle = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectGroups groups={groupSessions(items, "anakin")} collapsed={collapsedKeys(opened ? [ARCHIVE_ENTRY] : [])} pathname="/" onToggle={onToggle} onNew={vi.fn()} onNavigate={vi.fn()} onDeleted={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return onToggle;
  };

  it("keeps the Archive closed until the person opens it, and leaves the other groups as they were", () => {
    mountArchive(archivedList, false);
    const group = screen.getByRole("region", { name: "Archive" });
    expect(within(group).getByRole("button", { name: /Archive/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(group).queryByText("Title b")).toBeNull();
    expect(screen.getByText("Title a")).toBeVisible();
  });

  it("lists what is archived once opened, with the project of a coding session, and no button to start a new one", () => {
    mountArchive(archivedList, true);
    const group = screen.getByRole("region", { name: "Archive" });
    expect(within(group).getByRole("button", { name: /Archive/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(group).getByText("Title b")).toBeVisible();
    expect(within(group).getByText(/app · anakin/)).toBeVisible();
    expect(within(group).getByText("Old chat")).toBeVisible();
    expect(within(group).queryByRole("button", { name: /New/ })).toBeNull();
  });

  it("asks to open the Archive when it is closed", async () => {
    const onToggle = mountArchive(archivedList, false);
    await userEvent.click(within(screen.getByRole("region", { name: "Archive" })).getByRole("button", { name: /Archive/ }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ kind: "archive" }), false);
  });

  it("shows on a closed Archive that something in it is waiting for the person", () => {
    const waiting = [{ ...code("b", "anakin", "p"), archived: true, waiting: "approval" as const, read: 0, events: 3 }];
    mountArchive(waiting, false);
    expect(screen.getByLabelText("Something in the archive is waiting for you")).toBeInTheDocument();
  });

  it("marks a waiting conversation in an open Archive by its own mark", () => {
    mountArchive([{ ...code("b", "anakin", "p"), archived: true, waiting: "approval" as const, read: 0, events: 3 }], true);
    expect(screen.getByText("Waiting for your approval")).toBeInTheDocument();
    expect(screen.queryByLabelText("Something in the archive is waiting for you")).toBeNull();
  });
});
