import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { groupSessions } from "@/lib/groups";
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
});
