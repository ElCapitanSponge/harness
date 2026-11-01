import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

// What a model writes is not trusted: it must never become markup that runs.
describe("Markdown", () => {
  it("does not turn raw HTML from a model into elements", () => {
    const { container } = render(<Markdown text="hello <script>window.pwned = 1</script> <img src=x onerror=alert(1)> <b>bold</b>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("drops a link that would run script, and opens real links safely", () => {
    render(<Markdown text="[bad](javascript:alert(1)) and [good](https://example.com/a)" />);
    expect(screen.getByText("bad").closest("a")?.getAttribute("href") ?? "").not.toContain("javascript:");
    const good = screen.getByRole("link", { name: "good" });
    expect(good).toHaveAttribute("href", "https://example.com/a");
    expect(good).toHaveAttribute("target", "_blank");
    expect(good.getAttribute("rel")).toContain("noopener");
  });

  it("renders lists, tables and code with its language, and copies the code", async () => {
    const writeText = vi.fn(() => {
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Markdown text={"- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("colours a diff's added and removed lines", () => {
    const { container } = render(<Markdown text={"```diff\n-old\n+new\n```"} />);
    expect(container.querySelector(".hljs-addition")).not.toBeNull();
    expect(container.querySelector(".hljs-deletion")).not.toBeNull();
  });
});
