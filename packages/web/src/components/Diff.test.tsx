import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Diff } from "./Diff";

const patch = "@@ -9,3 +9,3 @@\n keep\n-old\n+new";

describe("a diff with line numbers", () => {
  it("shows the old and new number of each line in a gutter beside its text", () => {
    render(<Diff patch={patch} />);
    const removed = screen.getByText("-old").parentElement;
    const added = screen.getByText("+new").parentElement;
    const kept = screen.getByText("keep").parentElement;
    expect(removed).toHaveTextContent(/^10-old$/);
    expect(added).toHaveTextContent(/^10\+new$/);
    expect(kept).toHaveTextContent(/^99 keep$/);
  });

  it("keeps the numbers out of the text a person selects and out of what a screen reader reads", () => {
    const { container } = render(<Diff patch={patch} />);
    const gutters = container.querySelectorAll("span[aria-hidden]");
    expect(gutters.length).toBe(8);
    for (const g of gutters) {
      expect(g).toHaveClass("select-none");
    }
  });

  it("still colours added and removed lines", () => {
    render(<Diff patch={patch} />);
    expect(screen.getByText("-old")).toHaveClass("text-destructive");
    expect(screen.getByText("+new")).toHaveClass("text-success");
  });
});
