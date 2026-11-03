import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./overlay";

const show = (extra: Partial<ComponentProps<typeof ConfirmDialog>> = {}) => {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete it?" description="Gone for good." confirmLabel="Delete" onConfirm={onConfirm} {...extra} />);
  return { onOpenChange, onConfirm };
};

describe("Confirm dialog", () => {
  it("is an alert dialog with its title and description", () => {
    show();
    const dialog = screen.getByRole("alertdialog", { name: "Delete it?" });
    expect(dialog).toHaveAccessibleDescription("Gone for good.");
  });

  it("puts focus on Cancel, the safe answer", async () => {
    show();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
  });

  it("asks to close on Escape", async () => {
    const { onOpenChange, onConfirm } = show();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not close on a click outside, so a stray tap cannot confirm", () => {
    const { onOpenChange, onConfirm } = show();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", async () => {
    show();
    const dialog = screen.getByRole("alertdialog");
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("confirms with the confirm button and leaves closing to the caller", async () => {
    const { onOpenChange, onConfirm } = show();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("cancels with the cancel button", async () => {
    const { onOpenChange, onConfirm } = show({ cancelLabel: "Keep it" });
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables the confirm button while it works, and shows an error", () => {
    show({ pending: true, error: "The gateway said no" });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("The gateway said no");
  });
});
