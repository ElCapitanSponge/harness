import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ApprovalItem } from "./ApprovalCard";
import { PlanApproval } from "./PlanApproval";

const PLAN = "# Fix the Windows build\n\n## Approach\n\nThe path join in `scripts/build.ts` uses `/`, which breaks on Windows.\n\n## Steps\n\n1. Read `scripts/build.ts`\n2. Use `path.join`\n3. Run `pnpm test`\n\n## Risks\n\n- The CI cache key also uses the path.";

const item = (over: Partial<ApprovalItem> = {}): { item: ApprovalItem } => {
  return { item: { approvalId: "p1", tool: "plan", summary: "Approve this plan?", status: "pending", preview: { kind: "file", title: "The plan", text: PLAN }, ...over } };
};

const meta = {
  title: "Conversation/Plan approval",
  component: PlanApproval,
  args: { onAnswer: fn() },
  decorators: [
    (Story) => {
      return <div className="mx-auto max-w-3xl"><Story /></div>;
    },
  ],
} satisfies Meta<typeof PlanApproval>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {
  args: item(),
  play: async ({ canvasElement, args }) => {
    // The plan is read as a document, and approving says what follows.
    const canvas = within(canvasElement);
    await expect(within(canvas.getByLabelText("The plan")).getByRole("heading", { name: "Fix the Windows build" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Approve, accept file edits" }));
    await expect(args.onAnswer).toHaveBeenCalledWith("p1", true, false, undefined, { next: "edits" });
  },
};

export const EditedBeforeApproving: Story = {
  args: item(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Edit" }));
    await userEvent.type(canvas.getByLabelText("Edit the plan"), "\n- Check the lockfile");
    await expect(canvas.getByText(/You edited the plan/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Approve, ask before each change" }));
    await expect(args.onAnswer).toHaveBeenCalledWith("p1", true, false, undefined, { next: "ask", plan: `${PLAN}\n- Check the lockfile` });
  },
};

export const RequestingChanges: Story = {
  args: item(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("What to change (optional)"), "Cover the CI cache too");
    await userEvent.click(canvas.getByRole("button", { name: "Request changes" }));
    await expect(args.onAnswer).toHaveBeenCalledWith("p1", false, false, "Cover the CI cache too");
  },
};

export const Approved: Story = {
  args: item({ status: "allowed" }),
  play: async ({ canvasElement }) => {
    // Nothing left to press, and the plan can still be read.
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Approve the plan (approved)")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /Approve,/ })).toBeNull();
    await expect(canvas.getByText("Show the plan")).toBeVisible();
  },
};

export const ChangesRequested: Story = {
  args: item({ status: "declined", reason: "Cover the CI cache too" }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Changes requested: Cover the CI cache too")).toBeVisible();
  },
};
