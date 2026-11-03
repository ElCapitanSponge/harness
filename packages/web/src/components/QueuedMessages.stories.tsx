import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { QueuedMessages } from "./QueuedMessages";

const meta = {
  title: "Conversation/Queued messages",
  component: QueuedMessages,
  args: { held: false, onEdit: fn(), onRemove: fn(), onSendNow: fn() },
} satisfies Meta<typeof QueuedMessages>;

export default meta;
type Story = StoryObj<typeof meta>;

const MESSAGES = [
  { id: "a", text: "Also add a test for the empty case", images: 0 },
  { id: "b", text: "And check it on Windows\nwith the long path", images: 2 },
];

export const Empty: Story = {
  args: { messages: [] },
  play: async ({ canvasElement }) => {
    // Nothing waiting, nothing shown.
    await expect(within(canvasElement).queryByRole("region", { name: "Queued messages" })).toBeNull();
  },
};

export const Queued: Story = {
  args: { messages: MESSAGES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // In the order they will be taken up.
    const items = within(canvas.getByRole("list")).getAllByRole("listitem");
    await expect(items).toHaveLength(2);
    await expect(items[0]).toHaveTextContent("Also add a test for the empty case");
    await expect(items[1]).toHaveTextContent("(2 images)");
    await userEvent.click(canvas.getByRole("button", { name: /send now.*long path/i }));
    await expect(args.onSendNow).toHaveBeenCalledWith("b");
    await userEvent.click(canvas.getByRole("button", { name: "Remove queued message 1" }));
    await expect(args.onRemove).toHaveBeenCalledWith("a");
  },
};

export const Editing: Story = {
  args: { messages: MESSAGES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Edit queued message 1" }));
    const box = canvas.getByLabelText("Reword queued message 1");
    await userEvent.clear(box);
    await userEvent.type(box, "Reworded{Enter}");
    await expect(args.onEdit).toHaveBeenCalledWith("a", "Reworded");
    // Escape keeps the message as it was.
    await userEvent.click(canvas.getByRole("button", { name: "Edit queued message 2" }));
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByLabelText("Reword queued message 2")).toBeNull();
    await expect(args.onEdit).toHaveBeenCalledTimes(1);
  },
};

export const EditingWithTheMessageBoxTools: Story = {
  args: { messages: MESSAGES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Edit queued message 2" }));
    // The same toolbar and coloured box as the message box, and a new line with Shift+Enter that is kept when saved.
    await expect(canvas.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
    await expect(canvas.getByTestId("markdown-backdrop")).toBeInTheDocument();
    await userEvent.type(canvas.getByLabelText("Reword queued message 2"), "{Shift>}{Enter}{/Shift}and a third line");
    await userEvent.click(canvas.getByRole("button", { name: "Save the change" }));
    await expect(args.onEdit).toHaveBeenCalledWith("b", "And check it on Windows\nwith the long path\nand a third line");
  },
};
export const HeldAfterACancel: Story = {
  args: { messages: MESSAGES, held: true },
  play: async ({ canvasElement }) => {
    // Said in words, so it is not mistaken for messages that are about to go.
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Held: the last turn did not finish");
  },
};
