import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("sends while a turn is running when the page queues, and keeps Stop beside it", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Composer draftKey="q" busy canQueue onSend={onSend} onStop={onStop} />);
    // With nothing written there is only Stop; once there is text the message can be queued.
    expect(screen.queryByRole("button", { name: "Queue message" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message"), "after this{Enter}");
    expect(onSend).toHaveBeenCalledWith("after this");
    expect(screen.getByLabelText("Message")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Message"), "and this");
    await userEvent.click(screen.getByRole("button", { name: "Queue message" }));
    expect(onSend).toHaveBeenLastCalledWith("and this");
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

describe("Composer markdown", () => {
  const boxOf = (): HTMLTextAreaElement => {
    return screen.getByLabelText("Message");
  };

  it("wraps the selection with the shortcuts, and again takes it off", async () => {
    render(<Composer draftKey="md1" busy={false} onSend={vi.fn()} />);
    await userEvent.type(boxOf(), "make this bold");
    boxOf().setSelectionRange(5, 9);
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(boxOf()).toHaveValue("make **this** bold");
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(boxOf()).toHaveValue("make this bold");
  });

  it("does the same from the toolbar, for code and for lists", async () => {
    render(<Composer draftKey="md2" busy={false} onSend={vi.fn()} />);
    await userEvent.type(boxOf(), "a{Shift>}{Enter}{/Shift}b");
    boxOf().setSelectionRange(0, 3);
    await userEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(boxOf()).toHaveValue("- a\n- b");
    await userEvent.click(screen.getByRole("button", { name: "Code block" }));
    expect(boxOf().value).toContain("```");
  });

  it("carries a list on with Shift+Enter instead of sending", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="md3" busy={false} onSend={onSend} />);
    await userEvent.type(boxOf(), "- one{Shift>}{Enter}{/Shift}two");
    expect(boxOf()).toHaveValue("- one\n- two");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("adds a line inside a code block on Enter, and sends the whole of it on Ctrl+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="md4" busy={false} onSend={onSend} />);
    await userEvent.type(boxOf(), "```ts{Enter}const a = 1;{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(boxOf()).toHaveValue("```ts\nconst a = 1;\n");
    await userEvent.type(boxOf(), "```{Enter}");
    // The block is closed now, so Enter sends.
    expect(onSend).toHaveBeenCalledWith("```ts\nconst a = 1;\n```");
  });

  it("sends from inside a code block with Ctrl+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="md5" busy={false} onSend={onSend} />);
    await userEvent.type(boxOf(), "```{Enter}code");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledWith("```\ncode");
  });

  it("previews what will be sent, and goes back to editing without losing it", async () => {
    render(<Composer draftKey="md6" busy={false} onSend={vi.fn()} />);
    await userEvent.type(boxOf(), "**bold** and `code`");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByLabelText("Preview of your message");
    expect(within(preview).getByText("bold").tagName).toBe("STRONG");
    expect(within(preview).getByText("code").tagName).toBe("CODE");
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(boxOf()).toHaveValue("**bold** and `code`");
  });
});

describe("Composer slash menu", () => {
  const skills = [
    { name: "tdd", description: "Test-driven development.", hint: "[what]", length: 100, modelInvocable: true, source: "user" },
    { name: "triage", description: "Sort the issues.", length: 100, modelInvocable: false, source: "user" },
  ];

  it("lists the skills when a message starts with /, filters as it is typed, and completes the name with the keyboard", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="s" busy={false} skills={skills} onSend={onSend} />);
    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "/");
    const list = screen.getByRole("listbox", { name: "Skills" });
    expect(within(list).getAllByRole("option")).toHaveLength(2);
    expect(within(list).getByText("[what]")).toBeInTheDocument();

    await userEvent.type(box, "tr");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await userEvent.type(box, "{Enter}");
    // Enter completed the name instead of sending.
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("/triage ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.type(box, "now{Enter}");
    expect(onSend).toHaveBeenCalledWith("/triage now");
  });

  it("moves with the arrows, picks with a click, and closes with Escape", async () => {
    render(<Composer draftKey="s" busy={false} skills={skills} onSend={vi.fn()} />);
    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "/{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.type(box, "{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "/");
    await userEvent.click(screen.getByRole("option", { name: /tdd/ }));
    expect(box).toHaveValue("/tdd ");
  });

  it("shows nothing without skills, or when the slash is not at the start", async () => {
    const first = render(<Composer draftKey="s" busy={false} onSend={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "/");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    first.unmount();
    localStorage.clear();
    render(<Composer draftKey="t" busy={false} skills={skills} onSend={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message"), "see /");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("Composer images", () => {
  const png = (name = "cat.png", size = 12) => {
    return new File([new Uint8Array(size)], name, { type: "image/png" });
  };

  it("offers no attach button unless the page allows images", () => {
    render(<Composer draftKey="i" busy={false} onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Attach an image" })).not.toBeInTheDocument();
  });

  it("attaches a chosen picture, shows it, lets it be removed, and sends it with the text", async () => {
    const onSend = vi.fn();
    render(<Composer draftKey="i" busy={false} imageNote="" onSend={onSend} />);
    await userEvent.upload(screen.getByLabelText("Choose images"), [png("a.png"), png("b.png")]);
    const list = await screen.findByRole("list", { name: "Attached images" });
    expect(within(list).getAllByRole("img")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(within(screen.getByRole("list", { name: "Attached images" })).getAllByRole("img")).toHaveLength(1);

    await userEvent.type(screen.getByLabelText("Message"), "what is this?{Enter}");
    expect(onSend).toHaveBeenCalledWith("what is this?", [{ mediaType: "image/png", data: expect.any(String) as string }]);
    expect(screen.queryByRole("list", { name: "Attached images" })).not.toBeInTheDocument();
  });

  it("refuses another type, a picture that is too big, and more than the limit, saying why", async () => {
    render(<Composer draftKey="i" busy={false} imageNote="" onSend={vi.fn()} />);
    const input = screen.getByLabelText("Choose images");
    await userEvent.upload(input, new File(["x"], "doc.pdf", { type: "application/pdf" }), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("doc.pdf is not a PNG, JPEG, GIF or WebP image.");

    await userEvent.upload(input, png("huge.png", 6 * 1024 * 1024));
    expect(await screen.findByRole("alert")).toHaveTextContent("huge.png is larger than 5 MB.");

    await userEvent.upload(input, [png("1.png"), png("2.png"), png("3.png"), png("4.png"), png("5.png")]);
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 4 images");
    expect(within(screen.getByRole("list", { name: "Attached images" })).getAllByRole("img")).toHaveLength(4);
  });

  it("warns that the model cannot read the picture when the page says so", async () => {
    render(<Composer draftKey="i" busy={false} imageNote="qwen does not look like a model that can read images, so the image was not sent." onSend={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("Choose images"), png());
    expect(await screen.findByRole("status")).toHaveTextContent("does not look like a model that can read images");
  });
});

describe("Composer files as context", () => {
  afterEach(() => {
    delete (window as unknown as { torii?: unknown }).torii;
  });

  it("puts the text of files chosen with the desktop app's file picker into the message, with their paths", async () => {
    (window as unknown as { torii: unknown }).torii = {
      desktop: true,
      nodeId: "anakin",
      pickFiles: () => {
        return Promise.resolve([{ path: "C:\notes\todo.md", name: "todo.md", content: "- one\n" }, { path: "C:\big.bin", name: "big.bin", problem: "big.bin looks like a binary file, not text." }]);
      },
    };
    render(<Composer draftKey="ctx" busy={false} imageNote="" onSend={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add files as context" }));
    const box = screen.getByLabelText("Message");
    await waitFor(() => {
      expect(box).toHaveValue("C:\notes\todo.md:\n```\n- one\n```\n");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("big.bin looks like a binary file");
  });

  it("adds text handed in from outside, such as a file chosen in the panel, once each time", async () => {
    const { rerender } = render(<Composer draftKey="ctx2" busy={false} onSend={vi.fn()} insertion={undefined} />);
    await userEvent.type(screen.getByLabelText("Message"), "Look at this");
    rerender(<Composer draftKey="ctx2" busy={false} onSend={vi.fn()} insertion={{ id: 1, text: "src/a.ts:\n```\nx\n```" }} />);
    const box = screen.getByLabelText("Message");
    await waitFor(() => {
      expect(box).toHaveValue("Look at this\n\nsrc/a.ts:\n```\nx\n```\n");
    });
    rerender(<Composer draftKey="ctx2" busy={false} onSend={vi.fn()} insertion={{ id: 1, text: "src/a.ts:\n```\nx\n```" }} />);
    expect(box).toHaveValue("Look at this\n\nsrc/a.ts:\n```\nx\n```\n");
  });
});
