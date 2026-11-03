import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModePicker } from "./ModePicker";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Mode picker", () => {
  it("lists the four modes, with ask first and the risky one marked", () => {
    render(<ModePicker value="ask" onChange={vi.fn()} />);
    const options = screen.getAllByRole("option").map((o) => {
      return o.textContent;
    });
    expect(options).toEqual(["Ask before every change", "Accept file edits", "Plan first", "Run without asking (risky)"]);
    expect(screen.getByLabelText("Changes")).toHaveValue("ask");
  });

  it("changes mode at once for the safer modes", async () => {
    const onChange = vi.fn();
    render(<ModePicker value="ask" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Changes"), "plan");
    expect(onChange).toHaveBeenCalledWith("plan");
  });

  it("asks to be sure before running without asking: cancel leaves the mode as it was, confirm sets it", async () => {
    const onChange = vi.fn();
    render(<ModePicker value="ask" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Changes"), "bypass");
    expect(screen.getByRole("alertdialog", { name: "Run without asking?" })).toHaveTextContent("without asking you first");
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Changes")).toHaveValue("ask");

    await userEvent.selectOptions(screen.getByLabelText("Changes"), "bypass");
    await userEvent.click(screen.getByRole("button", { name: "Run without asking" }));
    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("marks the conversation clearly while it runs without asking", () => {
    render(<ModePicker value="bypass" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Nothing asks in this mode")).toBeInTheDocument();
  });
});
