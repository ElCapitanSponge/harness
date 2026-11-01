import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Composer } from "./Composer";

const meta = {
  title: "Conversation/Composer",
  component: Composer,
  args: { draftKey: "story", busy: false, onSend: fn(), onStop: fn() },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Nothing to send yet.
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(canvas.getByLabelText("Message"), "hello{Enter}");
    await expect(args.onSend).toHaveBeenCalledWith("hello");
    await expect(canvas.getByLabelText("Message")).toHaveValue("");
  },
};

export const ShiftEnterMakesANewLine: Story = {
  args: { draftKey: "story-shift" },
  play: async ({ canvasElement, args }) => {
    const box = within(canvasElement).getByLabelText("Message");
    await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two");
    await expect(box).toHaveValue("one\ntwo");
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

export const Busy: Story = {
  args: { busy: true, draftKey: "story-busy" },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Stop" }));
    await expect(args.onStop).toHaveBeenCalled();
  },
};

export const DisabledWithAReason: Story = { args: { disabled: true, placeholder: "The device is offline", draftKey: "story-off" } };
