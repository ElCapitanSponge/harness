import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "@/lib/conversation";
import { SidePanel } from "./SidePanel";

const files: ChangedFile[] = [
  { path: "src/new.ts", created: true, added: 2, removed: 0, diffs: [{ patch: "@@ -0,0 +1,2 @@\n+one\n+two" }] },
  { path: "src/a.ts", created: false, added: 3, removed: 2, diffs: [{ patch: "@@ -1,2 +1,2 @@\n-old\n+new" }, { note: "large change, not shown" }] },
];

describe("Side panel", () => {
  it("lists the plan and the changed files, newest first, with counts", () => {
    render(<SidePanel changes={files} plan={[{ text: "read it", status: "done" }, { text: "fix it", status: "in_progress" }, { text: "test it", status: "pending" }]} onClose={vi.fn()} />);
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(plan).getAllByRole("listitem")).toHaveLength(3);
    expect(within(plan).getByLabelText("in progress")).toBeInTheDocument();

    const list = within(screen.getByRole("region", { name: "Changed files" })).getAllByRole("listitem");
    expect(list.map((li) => {
      return li.textContent;
    })).toEqual(["src/new.ts+2 -0", "src/a.ts+3 -2"]);
    expect(within(screen.getByRole("button", { name: /src\/new\.ts/ })).getByLabelText("created")).toBeInTheDocument();
  });

  it("opens a file to its diff, colouring added and removed lines, and says when a change was too big to show", async () => {
    render(<SidePanel changes={files} plan={[]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    const detail = screen.getByRole("region", { name: "Changes to src/a.ts" });
    expect(within(detail).getByText("-old")).toHaveClass("text-destructive");
    expect(within(detail).getByText("+new")).toHaveClass("text-success");
    expect(within(detail).getByText("large change, not shown")).toBeInTheDocument();
    expect(within(detail).getByText("Change 2 of 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All files" }));
    expect(screen.getByRole("region", { name: "Changed files" })).toBeInTheDocument();
  });

  it("says so when nothing has changed, and closes", async () => {
    const onClose = vi.fn();
    render(<SidePanel changes={[]} plan={[]} onClose={onClose} />);
    expect(screen.getByText("No file has been changed yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Plan" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Side panel background tasks", () => {
  it("lists the commands running in the background with their state", () => {
    render(<SidePanel changes={[]} plan={[]} tasks={[{ id: "t1", command: "pnpm dev", status: "running", startedAt: 1 }, { id: "t2", command: "pnpm build", status: "exited", code: 2, startedAt: 2 }, { id: "t3", command: "node x", status: "stopped", startedAt: 3 }]} onClose={vi.fn()} />);
    const list = within(screen.getByRole("region", { name: "Background tasks" })).getAllByRole("listitem");
    expect(list.map((li) => {
      return li.textContent;
    })).toEqual(["pnpm devrunning", "pnpm buildexited (2)", "node xstopped"]);
  });

  it("has no tasks section when there are none", () => {
    render(<SidePanel changes={[]} plan={[]} onClose={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Background tasks" })).not.toBeInTheDocument();
  });
});

describe("Side panel screenshots", () => {
  it("shows the screenshots the agent browser took, with the address of each", () => {
    render(<SidePanel changes={[]} plan={[]} shots={[{ mediaType: "image/png", data: "AAAA", url: "https://example.com/" }]} onClose={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Screenshots" });
    expect(within(section).getByRole("img", { name: "Screenshot of https://example.com/" })).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(within(section).getByText("https://example.com/")).toBeInTheDocument();
  });
});

describe("Side panel clearing", () => {
  const plan = [{ text: "read it", status: "done" as const }, { text: "fix it", status: "in_progress" as const }];
  const tasks = [{ id: "t1", command: "pnpm dev", status: "running" as const, startedAt: 1 }, { id: "t2", command: "pnpm build", status: "exited" as const, code: 0, startedAt: 2 }];

  it("clears the done steps of the plan, and shows the button only when a step is done", async () => {
    const onClearPlan = vi.fn();
    const first = render(<SidePanel changes={[]} plan={plan} onClearPlan={onClearPlan} onClose={vi.fn()} />);
    await userEvent.click(within(screen.getByRole("region", { name: "Plan" })).getByRole("button", { name: "Clear done" }));
    expect(onClearPlan).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<SidePanel changes={[]} plan={[{ text: "fix it", status: "pending" }]} onClearPlan={onClearPlan} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear done" })).not.toBeInTheDocument();
  });

  it("clears the finished tasks, and shows the button only when one has ended", async () => {
    const onClearTasks = vi.fn();
    const first = render(<SidePanel changes={[]} plan={[]} tasks={tasks} onClearTasks={onClearTasks} onClose={vi.fn()} />);
    await userEvent.click(within(screen.getByRole("region", { name: "Background tasks" })).getByRole("button", { name: "Clear finished" }));
    expect(onClearTasks).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<SidePanel changes={[]} plan={[]} tasks={tasks.slice(0, 1)} onClearTasks={onClearTasks} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear finished" })).not.toBeInTheDocument();
  });

  it("offers no clearing where the page gives none, and says plainly when clearing failed", () => {
    const view = render(<SidePanel changes={[]} plan={plan} tasks={tasks} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Clear/ })).not.toBeInTheDocument();
    view.rerender(<SidePanel changes={[]} plan={plan} tasks={tasks} clearError="This device runs an older agent that cannot clear finished tasks." onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("older agent");
  });
});
