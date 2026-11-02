import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Message } from "./Messages";
import type { Item } from "@/lib/conversation";

const question = (over: Partial<Extract<Item, { kind: "question" }>> = {}): Item => {
  return { kind: "question", id: 1, questionId: "q1", question: "Which database?", options: ["SQLite", "Postgres"], status: "pending", ...over };
};

describe("question card", () => {
  it("answers with an option, or with the person's own words", async () => {
    const onReply = vi.fn();
    render(<Message item={question()} model="qwen" onAnswer={vi.fn()} onReply={onReply} />);
    expect(screen.getByText("Which database?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Postgres" }));
    expect(onReply).toHaveBeenCalledWith("q1", "Postgres");

    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Your answer"), "DuckDB{Enter}");
    expect(onReply).toHaveBeenLastCalledWith("q1", "DuckDB");
  });

  it("shows the answer once given, with nothing left to press, and says when nobody answered", () => {
    const first = render(<Message item={question({ status: "answered", answer: "SQLite" })} model="qwen" onAnswer={vi.fn()} />);
    expect(screen.getByText("You answered: SQLite")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    first.unmount();
    render(<Message item={question({ status: "unanswered" })} model="qwen" onAnswer={vi.fn()} />);
    expect(screen.getByText("Nobody answered.")).toBeInTheDocument();
  });
});
