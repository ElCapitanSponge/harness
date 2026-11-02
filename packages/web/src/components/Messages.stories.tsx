import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Item } from "@/lib/conversation";
import { Message, StatusLine } from "./Messages";

const meta = {
  title: "Conversation/Message",
  component: Message,
  args: { model: "qwen3-coder-30b", onAnswer: fn() },
  decorators: [
    (Story) => {
      return <div className="mx-auto max-w-3xl"><Story /></div>;
    },
  ],
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

const item = (value: Item): { item: Item } => {
  return { item: value };
};

export const FromYou: Story = { args: item({ kind: "user", id: 1, text: "Why does the build fail on Windows?" }) };

export const FromYouWithMarkdown: Story = {
  args: item({ kind: "user", id: 30, text: "Please **summarise** this:\n\n- the feedback\n- the `ui` issues\n\n```ts\nconst a = 1;\n```" }),
  play: async ({ canvasElement }) => {
    // What you wrote is shown as you wrote it in markdown: emphasis, lists and code, not the raw marks.
    const canvas = within(canvasElement);
    await expect(canvas.getByText("summarise").tagName).toBe("STRONG");
    await expect(canvas.getAllByRole("listitem")).toHaveLength(2);
    // The code is highlighted, so its words sit in separate elements; the text as a whole is still there.
    await expect(canvasElement).toHaveTextContent("const a = 1;");
  },
};

export const TextThatCannotBreak: Story = {
  // A model that writes with non-breaking spaces gives lines with nowhere to wrap. They must wrap inside the column, not push the page wider.
  args: item({ kind: "assistant", id: 31, streaming: false, text: "Objective:\u00a0Transition\u00a0to\u00a0using\u00a0Torii\u00a0as\u00a0the\u00a0primary\u00a0daily\u00a0driver\u00a0and\u00a0replace\u00a0the\u00a0previous\u00a0tool\u00a0entirely\u00a0so\u00a0that\u00a0the\u00a0harness\u00a0needs\u00a0to\u00a0support\u00a0several\u00a0key\u00a0capabilities", model: "gemma" }),
  decorators: [
    (Story) => {
      return <div className="w-72 overflow-hidden border"><Story /></div>;
    },
  ],
};

export const Reply: Story = {
  args: item({
    kind: "assistant",
    id: 2,
    streaming: false,
    text: "The path is built with a forward slash.\n\n- Use `path.join`\n- Avoid string concatenation\n\n```ts\nconst file = path.join(dir, \"out.txt\");\n```\n\n| Platform | Separator |\n| --- | --- |\n| Windows | `\\` |\n| Linux | `/` |",
  }),
};

export const ReplyFromAnotherDevice: Story = {
  args: item({ kind: "assistant", id: 20, streaming: false, text: "Answered by a different model on a different machine.", model: "gemma-3-12b", device: "bastila" }),
  play: async ({ canvasElement }) => {
    // Each reply says which model wrote it and where it ran, so a conversation that moves between them stays readable.
    await expect(within(canvasElement).getByText("gemma-3-12b")).toBeVisible();
    await expect(within(canvasElement).getByText("on bastila")).toBeVisible();
  },
};

export const ReplyWithADiff: Story = {
  args: item({ kind: "assistant", id: 3, streaming: false, text: "Here is the change:\n\n```diff\n--- a/sum.js\n+++ b/sum.js\n@@ -1,3 +1,3 @@\n-const total = a - b;\n+const total = a + b;\n```" }),
};

export const Streaming: Story = { args: item({ kind: "assistant", id: 4, streaming: true, text: "Let me look at the file and" }) };

export const ThinkingNow: Story = { args: item({ kind: "thinking", id: 5, live: true, startedAt: Date.now() - 4000, seconds: 0, text: "The user wants the failing test. I should read the test file first." }) };

export const ThoughtAbout: Story = { args: item({ kind: "thinking", id: 6, live: false, startedAt: 0, seconds: 12, text: "Checked three files." }) };

export const ToolCall: Story = { args: item({ kind: "tool", id: 7, summary: "read_file src/sum.js" }) };

export const ErrorNote: Story = { args: item({ kind: "note", id: 8, tone: "error", text: "no connected device has qwen loaded" }) };

export const InfoNote: Story = { args: item({ kind: "note", id: 9, tone: "info", text: "Cancelled." }) };

export const CompactedAutomatically: Story = {
  args: item({ kind: "compaction", id: 12, messages: 14, tokensBefore: 26_400, tokensAfter: 3100, manual: false }),
  play: async ({ canvasElement }) => {
    // The person sees that it happened, and by how much.
    await expect(within(canvasElement).getByRole("separator", { name: "Conversation compacted" })).toHaveTextContent("Compacted automatically: 14 earlier messages summarised, about 26k to 3.1k tokens");
  },
};

export const ApprovalWaiting: Story = {
  args: item({ kind: "approval", id: 10, approvalId: "a1", tool: "write_file", summary: "write src/sum.js (42 bytes)", status: "pending" }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Allow" }));
    await expect(args.onAnswer).toHaveBeenCalledWith("a1", true, false);
    await userEvent.click(canvas.getByRole("button", { name: /allow write_file for this conversation/i }));
    await expect(args.onAnswer).toHaveBeenCalledWith("a1", true, true);
    await userEvent.click(canvas.getByRole("button", { name: /allow write_file always in this project/i }));
    await expect(args.onAnswer).toHaveBeenCalledWith("a1", true, "project");
    await userEvent.click(canvas.getByRole("button", { name: "Decline" }));
    await expect(args.onAnswer).toHaveBeenCalledWith("a1", false, false);
  },
};

export const ApprovalAnswered: Story = {
  args: item({ kind: "approval", id: 11, approvalId: "a2", tool: "run_command", summary: "run pnpm test", status: "declined" }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: "Allow" })).toBeNull();
  },
};

export const WaitingForTheModel: StoryObj<typeof StatusLine> = {
  render: () => {
    return (
      <div className="grid gap-3">
        <StatusLine since={Date.now() - 3000} stage={undefined} />
        <StatusLine since={Date.now() - 9000} stage={{ name: "loading", detail: "qwen3-coder-30b" }} />
        <StatusLine since={Date.now() - 21000} stage={{ name: "waiting", detail: "qwen3-coder-30b on anakin" }} />
        <StatusLine since={Date.now() - 6000} stage={{ name: "compacting" }} />
      </div>
    );
  },
};
