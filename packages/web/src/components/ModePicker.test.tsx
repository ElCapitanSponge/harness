import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModePicker } from "./ModePicker";

afterEach(() => {
  vi.restoreAllMocks();
});

const openList = async (): Promise<void> => {
  await userEvent.click(screen.getByRole("combobox", { name: "Changes" }));
};

describe("Mode picker", () => {
  it("lists the four modes, with ask first, what each allows under it, and the risky one marked", async () => {
    render(<ModePicker value="ask" onChange={vi.fn()} />);
    const button = screen.getByRole("combobox", { name: "Changes" });
    expect(button).toHaveTextContent("Ask before every change");
    expect(button).not.toHaveTextContent("The default.");

    await openList();
    const options = screen.getAllByRole("option");
    const names = ["Ask before every change", "Accept file edits", "Plan first", "Run without asking"];
    expect(options).toHaveLength(4);
    names.forEach((name, index) => {
      expect(options[index]).toHaveAccessibleName(name);
    });
    // The hint is on the page, not in a tooltip.
    expect(screen.getByRole("option", { name: "Plan first" })).toHaveAccessibleDescription("The model can only read until you approve its plan.");
    expect(within(screen.getByRole("option", { name: "Run without asking" })).getByText("risky")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: "Plan first" })).queryByText("risky")).toBeNull();
  });

  it("changes mode at once for the safer modes", async () => {
    const onChange = vi.fn();
    render(<ModePicker value="ask" onChange={onChange} />);
    await openList();
    await userEvent.click(screen.getByRole("option", { name: "Plan first" }));
    expect(onChange).toHaveBeenCalledWith("plan");
  });

  it("asks to be sure before running without asking: cancel leaves the mode as it was, confirm sets it", async () => {
    const onChange = vi.fn();
    render(<ModePicker value="ask" onChange={onChange} />);
    await openList();
    await userEvent.click(screen.getByRole("option", { name: "Run without asking" }));
    expect(screen.getByRole("alertdialog", { name: "Run without asking?" })).toHaveTextContent("without asking you first");
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Changes" })).toHaveTextContent("Ask before every change");

    await openList();
    await userEvent.click(screen.getByRole("option", { name: "Run without asking" }));
    await userEvent.click(screen.getByRole("button", { name: "Run without asking" }));
    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("marks the conversation clearly while it runs without asking", () => {
    render(<ModePicker value="bypass" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Nothing asks in this mode")).toBeInTheDocument();
  });
});
