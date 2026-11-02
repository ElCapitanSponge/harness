import { describe, expect, it } from "vitest";
import { modelLabel } from "./Messages";

describe("the model named on a reply", () => {
  it("says so when Claude answered and the program did not report which model", () => {
    expect(modelLabel("claude")).toBe("Claude (model not reported)");
  });

  it("names the model the program reported, and any other model as it is", () => {
    expect(modelLabel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(modelLabel("qwen3-coder-30b")).toBe("qwen3-coder-30b");
  });
});
