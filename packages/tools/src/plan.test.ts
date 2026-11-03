import { MAX_PLAN_DOCUMENT } from "@harness/core";
import { describe, expect, it } from "vitest";
import { planToolForPlanMode, readPlanDocument } from "./plan.js";

describe("the plan as a markdown document", () => {
  it("is optional, and trimmed when sent", () => {
    expect(readPlanDocument({ steps: [] })).toBeUndefined();
    expect(readPlanDocument({ markdown: null })).toBeUndefined();
    expect(readPlanDocument({ markdown: "  \n " })).toBeUndefined();
    expect(readPlanDocument({ markdown: "\n# Plan\n\n- fix it\n" })).toBe("# Plan\n\n- fix it");
  });

  it("is an error the model can read when it is not text, or too long", () => {
    expect(() => {
      return readPlanDocument({ markdown: 3 });
    }).toThrow("\"markdown\" must be text");
    expect(() => {
      return readPlanDocument({ markdown: "x".repeat(MAX_PLAN_DOCUMENT + 1) });
    }).toThrow(String(MAX_PLAN_DOCUMENT));
    expect(readPlanDocument({ markdown: "x".repeat(MAX_PLAN_DOCUMENT) })).toHaveLength(MAX_PLAN_DOCUMENT);
  });

  it("is asked for in plan mode, with the approach, steps, files and risks", () => {
    const description = planToolForPlanMode().def.function.description ?? "";
    expect(description).toContain("markdown");
    expect(description).toContain("risks");
  });
});
