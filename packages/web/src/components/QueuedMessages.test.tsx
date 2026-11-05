import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "./QueuedMessages";

const show = (text: string) => {
  const onEdit = vi.fn();
  render(<QueuedMessages messages={[{ id: "a", text, images: 0, at: Date.parse("2026-11-05T14:32:00Z") }]} held={false} onEdit={onEdit} onRemove={vi.fn()} onSendNow={vi.fn()} />);
  return onEdit;
};

const open = async (): Promise<HTMLElement> => {
  await userEvent.click(screen.getByRole("button", { name: "Edit queued message 1" }));
  return screen.getByLabelText("Reword queued message 1");
};

describe("Rewording a queued message", () => {
  it("has the message box's tools: the formatting toolbar, the colouring and the preview", async () => {
    show("a **b**");
    await open();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
    expect(screen.getByTestId("markdown-backdrop")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(within(screen.getByLabelText("Preview of your message")).getByText("b").tagName).toBe("STRONG");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Reword queued message 1")).toHaveValue("a **b**");
  });

  it("keeps the line breaks it was given, adding a line with Shift+Enter", async () => {
    const onEdit = show("first");
    const box = await open();
    await userEvent.type(box, "{Shift>}{Enter}{/Shift}second");
    expect(box).toHaveValue("first\nsecond");
    await userEvent.click(screen.getByRole("button", { name: "Save the change" }));
    expect(onEdit).toHaveBeenCalledWith("a", "first\nsecond");
    expect(screen.queryByLabelText("Reword queued message 1")).not.toBeInTheDocument();
  });

  it("saves on Enter, and adds a line instead inside a code block, where Ctrl+Enter saves", async () => {
    const onEdit = show("```\ncode");
    const box = await open();
    await userEvent.type(box, "{Enter}more");
    expect(onEdit).not.toHaveBeenCalled();
    expect(box).toHaveValue("```\ncode\nmore");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onEdit).toHaveBeenCalledWith("a", "```\ncode\nmore");
  });

  it("saves a plain message on Enter", async () => {
    const onEdit = show("old");
    const box = await open();
    await userEvent.clear(box);
    await userEvent.type(box, "new{Enter}");
    expect(onEdit).toHaveBeenCalledWith("a", "new");
  });

  it("changes nothing when the text is empty, and keeps the message on Escape", async () => {
    const onEdit = show("old");
    const box = await open();
    await userEvent.clear(box);
    await userEvent.keyboard("{Enter}");
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reword queued message 1")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reword queued message 1")).not.toBeInTheDocument();
    expect(screen.getByText("old")).toBeInTheDocument();
  });

  it("still shows a message of several lines on one clipped line in the list", () => {
    show("one\ntwo\nthree");
    expect(screen.getByRole("listitem")).toHaveTextContent("one two three");
  });
});
