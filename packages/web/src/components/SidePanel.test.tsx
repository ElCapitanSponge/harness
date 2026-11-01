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
