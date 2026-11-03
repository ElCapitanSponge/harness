import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { groupKey, groupSessions } from "@/lib/groups";
import type { SessionInfo } from "@/lib/types";
import { collapsedKeys, ProjectGroups } from "./ProjectGroups";

const base = { model: "m", busy: false, events: 0, created: 0, deviceConnected: true };
const FIX_BUILD: SessionInfo = { ...base, id: "a", kind: "code", device: "anakin", root: "C:/work/app", title: "Fix the build", updated: 3 };
const DINNER: SessionInfo = { ...base, id: "b", kind: "chat", device: "", root: "", title: "Dinner ideas", updated: 2 };
const OLD_REFACTOR: SessionInfo = { ...base, id: "c", kind: "code", device: "anakin", root: "C:/work/app", title: "Old refactor", archived: true, updated: 1 };
const HOLIDAY: SessionInfo = { ...base, id: "d", kind: "chat", device: "", root: "", title: "Holiday plan", archived: true, updated: 0 };
const SESSIONS = [FIX_BUILD, DINNER, OLD_REFACTOR, HOLIDAY];

const noop = fn();

// Kept the way the gateway keeps it: a project is listed when the person closed it, and the Archive when the person opened it.
const Demo = ({ sessions }: { sessions: SessionInfo[] }) => {
  const [stored, setStored] = useState<{ device: string; root: string }[]>([]);
  return (
    <ProjectGroups
      groups={groupSessions(sessions, "anakin")}
      collapsed={collapsedKeys(stored)}
      pathname="/"
      onToggle={(group, value) => {
        const listed = group.kind === "archive" ? !value : value;
        setStored((before) => {
          const rest = before.filter((e) => {
            return groupKey(e.device, e.root) !== group.key;
          });
          return listed ? [...rest, { device: group.device, root: group.root }] : rest;
        });
      }}
      onNew={noop}
      onNavigate={noop}
      onDeleted={noop}
    />
  );
};

const meta = {
  title: "Sidebar/Project groups",
  component: Demo,
  args: { sessions: SESSIONS },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArchiveClosedThenOpened: Story = {
  play: async ({ canvasElement }) => {
    const archive = within(canvasElement).getByRole("region", { name: "Archive" });
    const header = within(archive).getByRole("button", { name: /Archive/ });
    // Closed to begin with, and nothing archived shows among the project's or the chats.
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(within(canvasElement).queryByText("Old refactor")).toBeNull();
    await userEvent.click(header);
    await expect(within(archive).getByText("Old refactor")).toBeVisible();
    await expect(within(archive).getByText(/app · anakin/)).toBeVisible();
    await expect(within(archive).getByText("Holiday plan")).toBeVisible();
    await userEvent.click(header);
    await expect(within(archive).queryByText("Old refactor")).toBeNull();
  },
};

export const WaitingInTheArchive: Story = {
  args: { sessions: [FIX_BUILD, { ...OLD_REFACTOR, waiting: "approval", read: 0, events: 3 }] },
  play: async ({ canvasElement }) => {
    // A closed Archive still says that something in it is waiting for the person.
    await expect(within(canvasElement).getByLabelText("Something in the archive is waiting for you")).toBeVisible();
  },
};

export const NothingArchived: Story = {
  args: { sessions: SESSIONS.filter((s) => {
    return s.archived !== true;
  }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("region", { name: "Archive" })).toBeNull();
  },
};
