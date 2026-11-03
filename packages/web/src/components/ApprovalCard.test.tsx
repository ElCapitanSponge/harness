import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard, type ApprovalItem } from "./ApprovalCard";

const item = (over: Partial<ApprovalItem> = {}): ApprovalItem => {
  return { approvalId: "a1", tool: "run_command", summary: "run: pnpm test", status: "pending", ...over };
};

const planItem = (over: Partial<ApprovalItem> = {}): ApprovalItem => {
  return item({ tool: "plan", summary: "Approve this plan?", preview: { kind: "file", title: "The plan", text: "# Fix the bug\n\n- read the tests\n- fix it" }, ...over });
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

  it("shows the outcome once answered, with the reason given, and nothing left to press", () => {
    render(<ApprovalCard item={item({ status: "declined", reason: "use the unit tests" })} onAnswer={vi.fn()} />);
    expect(screen.getByText("Reason given: use the unit tests")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Plan approval", () => {
  it("shows the plan as a document, with nothing to remember", () => {
    render(<ApprovalCard item={planItem()} onAnswer={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Plan approval" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("The plan")).getByRole("heading", { name: "Fix the bug" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /always/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /for this conversation/ })).not.toBeInTheDocument();
  });

  it("approves into asking before each change, or into accepting file edits", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={planItem()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Approve, ask before each change" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", true, false, undefined, { next: "ask" });
    await userEvent.click(screen.getByRole("button", { name: "Approve, accept file edits" }));
    expect(onAnswer).toHaveBeenLastCalledWith("a1", true, false, undefined, { next: "edits" });
  });

  it("sends the person's edit as the approved plan, and says so before they approve", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={planItem()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit the plan");
    expect(box).toHaveValue("# Fix the bug\n\n- read the tests\n- fix it");
    await userEvent.type(box, "\n- add a test");
    expect(screen.getByText(/You edited the plan/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done editing" }));
    expect(within(screen.getByLabelText("The plan")).getByText("add a test")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve, ask before each change" }));
    expect(onAnswer).toHaveBeenCalledWith("a1", true, false, undefined, { next: "ask", plan: "# Fix the bug\n\n- read the tests\n- fix it\n- add a test" });
  });

  it("sends no plan when it was opened for editing but not changed", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={planItem()} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve, ask before each change" }));
    expect(onAnswer).toHaveBeenCalledWith("a1", true, false, undefined, { next: "ask" });
  });

  it("requests changes with the reason, which goes back to the model as a decline", async () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard item={planItem()} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText("What to change (optional)"), "do the tests first");
    await userEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(onAnswer).toHaveBeenCalledWith("a1", false, false, "do the tests first");
  });

  it("keeps the plan to read once answered, and shows the reason for a request for changes", () => {
    render(<ApprovalCard item={planItem({ status: "declined", reason: "do the tests first" })} onAnswer={vi.fn()} />);
    expect(screen.getByText("Approve the plan (changes requested)")).toBeInTheDocument();
    expect(screen.getByText("Changes requested: do the tests first")).toBeInTheDocument();
    expect(screen.getByText("Show the plan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve,/ })).not.toBeInTheDocument();
  });
});
