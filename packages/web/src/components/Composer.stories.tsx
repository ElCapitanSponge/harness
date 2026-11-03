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

export const MarkdownStyledWhileTyping: Story = {
  args: { draftKey: "story-md" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByLabelText("Message");
    await userEvent.type(box, "# Title{Shift>}{Enter}{/Shift}**bold** and *it* and `code`{Shift>}{Enter}{/Shift}- item");
    const backdrop = canvas.getByTestId("markdown-backdrop");
    // The coloured copy shows the same words as the box, with each form picked out, and the box stays the only thing read aloud.
    await expect(box).toHaveValue("# Title\n**bold** and *it* and `code`\n- item");
    await expect(backdrop.textContent).toBe("# Title\n**bold** and *it* and `code`\n- item");
    await expect(backdrop).toHaveAttribute("aria-hidden", "true");
    await expect(within(backdrop).getByText("Title", { exact: false })).toHaveClass("text-primary");
    await expect(within(backdrop).getByText("**bold**")).toBeVisible();
    await expect(within(backdrop).getByText("`code`")).toHaveClass("bg-muted");
  },
};

export const FencedCodeIsStyledAcrossLines: Story = {
  args: { draftKey: "story-fence" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Message"), "```ts{Shift>}{Enter}{/Shift}const a = 1;{Shift>}{Enter}{/Shift}const b = 2;");
    const backdrop = canvas.getByTestId("markdown-backdrop");
    await expect(within(backdrop).getByText("const a = 1;", { exact: false })).toHaveClass("bg-muted");
    await expect(within(backdrop).getByText("const b = 2;", { exact: false })).toHaveClass("bg-muted");
  },
};

export const HtmlIsNeverRenderedAsMarkup: Story = {
  args: { draftKey: "story-html" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const hostile = "<img src=x onerror=alert(1)><script>alert(2)</script>**b**";
    await userEvent.type(canvas.getByLabelText("Message"), hostile);
    // Shown as text, never as elements, and what is sent is what was typed.
    await expect(canvasElement.querySelector("img")).toBeNull();
    await expect(canvasElement.querySelector("script")).toBeNull();
    await expect(canvas.getByTestId("markdown-backdrop").textContent).toBe(hostile);
    await userEvent.keyboard("{Enter}");
    await expect(args.onSend).toHaveBeenCalledWith(hostile);
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
