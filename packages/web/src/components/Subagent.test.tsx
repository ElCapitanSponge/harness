import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Message } from "./Messages";
import type { Item } from "@/lib/conversation";

const item = (over: Partial<Extract<Item, { kind: "subagent" }>> = {}): Item => {
  return { kind: "subagent", id: 1, childId: "c1", task: "find the config", status: "done", result: "found it", n: 2, of: 8, depth: 1, ...over };
};

const Block = ({ it }: { it: Item }) => {
  return (
    <MemoryRouter>
      <Message item={it} model="qwen" onAnswer={() => {
        return undefined;
      }}
      />
    </MemoryRouter>
  );
};

describe("sub-agent block", () => {
  it("names the task, shows the limits it counts against, the result, and a link to its conversation", () => {
    render(<Block it={item()} />);
    expect(screen.getByText("Sub-agent: find the config")).toBeInTheDocument();
    expect(screen.getByText("Sub-agent 2 of 8 allowed here, nested 1 deep.")).toBeInTheDocument();
    expect(screen.getByText("found it")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open its conversation" })).toHaveAttribute("href", "/c/c1");
  });

  it("shows that it is still running", () => {
    render(<Block it={item({ status: "running", result: undefined })} />);
    expect(screen.getByLabelText("running")).toBeInTheDocument();
  });
});
