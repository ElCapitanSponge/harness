import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard, type ApprovalItem } from "./ApprovalCard";

const item = (over: Partial<ApprovalItem> = {}): ApprovalItem => {
  return { approvalId: "a1", tool: "run_command", summary: "run: pnpm test", status: "pending", ...over };
};

describe("Approval card", () => {
  it("offers allow once, allow for this conversation, allow always in this project, and decline", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={item()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", true, false);
    await userEvent.click(screen.getByRole("button", { name: "Allow run_command for this conversation" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", true, true);
    await userEvent.click(screen.getByRole("button", { name: "Allow run_command always in this project" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", true, "project");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", false, false);
  });

  it("sends the reason with a decline, when one is given", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={item()} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText("Reason for declining (optional)"), "use the unit tests");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onAnswer).toHaveBeenCalledWith("a1", false, false, "use the unit tests");
  });

  it("shows the whole command and where it runs", () => {
    render(<ApprovalCard item={item({ preview: { kind: "command", title: "Runs in anakin:proj", text: "pnpm test --run" } })} onAnswer={vi.fn()} />);
    const preview = screen.getByLabelText("What will happen");
    expect(within(preview).getByText("Runs in anakin:proj")).toBeInTheDocument();
    expect(within(preview).getByText("pnpm test --run")).toBeInTheDocument();
  });

  it("shows the diff of an edit with added and removed lines coloured", () => {
    render(<ApprovalCard item={item({ tool: "edit_file", summary: "edit a.ts", preview: { kind: "diff", title: "a.ts", text: "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;" } })} onAnswer={vi.fn()} />);
    expect(screen.getByText("-const a = 1;")).toHaveClass("text-destructive");
    expect(screen.getByText("+const a = 2;")).toHaveClass("text-success");
  });

  it("is a plan approval for the plan tool: approve or decline, with nothing to remember", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={item({ tool: "plan", summary: "Approve this plan?", preview: { kind: "file", title: "The plan", text: "1. read\n2. fix" } })} onAnswer={onAnswer} />);
    expect(screen.getByRole("group", { name: "Plan approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /always/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /for this conversation/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve the plan" }));
    expect(onAnswer).toHaveBeenCalledWith("a1", true, false);
  });

  it("shows the outcome once answered, with the reason given, and nothing left to press", () => {
    render(<ApprovalCard item={item({ status: "declined", reason: "use the unit tests" })} onAnswer={vi.fn()} />);
    expect(screen.getByText("Reason given: use the unit tests")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
