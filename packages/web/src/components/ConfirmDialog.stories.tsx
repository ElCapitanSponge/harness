import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/overlay";

// The caller owns `open`, so the stories do too: they start open, and "Ask again" shows the question once more after it was answered.
const Demo = (props: Omit<ComponentProps<typeof ConfirmDialog>, "open" | "onOpenChange">) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-4">
      <Button onClick={() => {
        setOpen(true);
      }}
      >
        Ask again
      </Button>
      <ConfirmDialog {...props} open={open} onOpenChange={setOpen} />
    </div>
  );
};

const meta = {
  title: "Components/Confirm dialog",
  component: Demo,
  args: { title: "Discard the draft?", description: "What you wrote is not saved anywhere else.", confirmLabel: "Discard", onConfirm: fn() },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

// The dialog is drawn in a portal on the page, not inside the story, so it is found from the body.
const ask = async (name: string, cancelLabel = "Cancel"): Promise<HTMLElement> => {
  const dialog = await within(document.body).findByRole("alertdialog", { name });
  await waitFor(() => {
    return expect(within(dialog).getByRole("button", { name: cancelLabel })).toHaveFocus();
  });
  return dialog;
};

// Every story ends by answering No, so a modal never stays open over the next story.
const cancel = async (dialog: HTMLElement, name: string): Promise<void> => {
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => {
    return expect(within(document.body).queryByRole("alertdialog", { name })).toBeNull();
  });
};

export const Plain: Story = {
  play: async () => {
    const dialog = await ask("Discard the draft?");
    await cancel(dialog, "Discard the draft?");
  },
};

export const Destructive: Story = {
  args: { title: "Delete this conversation?", description: "Its history is removed from the gateway and cannot be brought back.", confirmLabel: "Delete", tone: "destructive" },
  play: async ({ args }) => {
    const dialog = await ask("Delete this conversation?");
    // Confirming asks the caller to act; the dialog stays until the caller closes it.
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await expect(within(document.body).getByRole("alertdialog", { name: "Delete this conversation?" })).toBeInTheDocument();
    await cancel(dialog, "Delete this conversation?");
  },
};

export const Risky: Story = {
  args: { title: "Run without asking?", description: "The model will be able to change files and run commands on the device without asking you first. The device's own allow list still applies.", confirmLabel: "Run without asking", tone: "risky" },
  play: async () => {
    const dialog = await ask("Run without asking?");
    await cancel(dialog, "Run without asking?");
  },
};

export const Working: Story = {
  args: { title: "Delete the old chats?", description: "They are removed one by one.", confirmLabel: "Delete", tone: "destructive", pending: true, error: "The gateway could not be reached." },
  play: async () => {
    const dialog = await ask("Delete the old chats?");
    await expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("The gateway could not be reached.");
    await cancel(dialog, "Delete the old chats?");
  },
};

export const LongText: Story = {
  args: {
    title: "Remove the device and everything it has been given?",
    description: "The device's key stops working at once, every session that ran on it is marked as lost, and the files the model wrote there stay on the machine. You can add the device again later with a new key, but its old sessions cannot be moved to it, and anything that was waiting in a queue for it is dropped.",
    confirmLabel: "Remove the device and its key",
    cancelLabel: "Keep the device",
    tone: "destructive",
  },
  play: async () => {
    const name = "Remove the device and everything it has been given?";
    const dialog = await ask(name, "Keep the device");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep the device" }));
    await waitFor(() => {
      return expect(within(document.body).queryByRole("alertdialog", { name })).toBeNull();
    });
  },
};

// Phone width: 375 px. The dialog keeps a 1rem margin each side and its buttons wrap rather than run off the screen.
export const Phone: Story = {
  args: { title: "Delete this chat?", description: "Its history is removed from the gateway and cannot be brought back.", confirmLabel: "Delete", tone: "destructive" },
  globals: { viewport: { value: "mobile1", isRotated: false } },
  play: async () => {
    const dialog = await ask("Delete this chat?");
    await cancel(dialog, "Delete this chat?");
  },
};
