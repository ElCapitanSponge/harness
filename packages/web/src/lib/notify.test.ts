import { describe, expect, it } from "vitest";
import type { Item } from "./conversation";
import { waitingFor } from "./notify";

describe("what is waiting on the person", () => {
  const approval = (status: "pending" | "allowed", tool = "run_command"): Item => {
    return { kind: "approval", id: 1, approvalId: "a1", tool, summary: "run: pnpm test", status };
  };

  it("is the latest approval or question that has not been answered", () => {
    expect(waitingFor([approval("pending")])).toEqual({ key: "approval-a1", title: "Torii: approval needed", body: "run: pnpm test" });
    expect(waitingFor([approval("pending", "plan")])?.title).toBe("Torii: approve the plan");
    expect(waitingFor([{ kind: "question", id: 2, questionId: "q1", question: "Which database?", options: [], status: "pending" }])).toEqual({ key: "question-q1", title: "Torii: a question for you", body: "Which database?" });
  });

  it("is nothing once answered, or when nothing was asked", () => {
    expect(waitingFor([approval("allowed")])).toBeUndefined();
    expect(waitingFor([])).toBeUndefined();
  });
});
