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

  it("asks to be sure before running without asking, and does nothing if the answer is no", async () => {
    const onChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ModePicker value="ask" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Changes"), "bypass");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("without asking you first") as string);
    expect(onChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.selectOptions(screen.getByLabelText("Changes"), "bypass");
    expect(onChange).toHaveBeenCalledWith("bypass");
  });

  it("marks the conversation clearly while it runs without asking", () => {
    render(<ModePicker value="bypass" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Nothing asks in this mode")).toBeInTheDocument();
  });
});
