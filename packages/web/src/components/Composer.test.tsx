import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

beforeEach(() => {
  localStorage.clear();
});

describe("Composer drafts", () => {
  it("keeps what was typed for a conversation, and brings it back after a reload", async () => {
    const first = render(<Composer draftKey="a" busy={false} onSend={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "half a thou");
    first.unmount();

    render(<Composer draftKey="a" busy={false} onSend={vi.fn()} />);
    expect(screen.getByLabelText("Message")).toHaveValue("half a thou");
  });

  it("keeps each conversation's draft apart", async () => {
    const first = render(<Composer draftKey="a" busy={false} onSend={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "for a");
    first.unmount();
    render(<Composer draftKey="b" busy={false} onSend={vi.fn()} />);
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("forgets the draft once it is sent, and sends it trimmed", async () => {
    const onSend = vi.fn();
    const first = render(<Composer draftKey="a" busy={false} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("Message"), "  hello  {Enter}");
    expect(onSend).toHaveBeenCalledWith("hello");
    first.unmount();
    render(<Composer draftKey="a" busy={false} onSend={onSend} />);
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("does not send while a turn is running or while disabled", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="a" busy disabled={false} onSend={onSend} onStop={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "again{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("still works when the browser blocks storage", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const onSend = vi.fn();
    render(<Composer draftKey="a" busy={false} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText("Message"), "hi{Enter}");
    expect(onSend).toHaveBeenCalledWith("hi");
    spy.mockRestore();
  });
});
