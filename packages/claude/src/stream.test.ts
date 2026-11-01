import { describe, expect, it, vi } from "vitest";
import { ClaudeLimitError, buildArgs, parseClaudeOutput, runClaude } from "./index.js";

const NOW = 1_793_500_000_000;

// The events the program prints, as seen from a real call.
const line = (value: object): string => {
  return JSON.stringify(value);
};

const rateLimit = (over: Record<string, unknown> = {}): string => {
  return line({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      resetsAt: 1_793_538_600,
      rateLimitType: "five_hour",
      isUsingOverage: false,
      unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1_793_538_600 }, seven_day: { utilization: 0.47, resetsAt: 1_793_599_200 } },
      ...over,
    },
  });
};

const success = line({
  type: "result",
  is_error: false,
  result: "ok",
  usage: { input_tokens: 2, cache_creation_input_tokens: 9841, cache_read_input_tokens: 100, output_tokens: 4 },
});

describe("parseClaudeOutput", () => {
  it("reads the reply, the counted tokens (cached input included) and the plan's two windows", () => {
    const out = [line({ type: "system" }), line({ type: "assistant", message: { model: "claude-haiku-5-5" } }), rateLimit(), success].join("\n");
    expect(parseClaudeOutput(out, "claude:haiku", NOW)).toEqual({
      text: "ok",
      model: "claude-haiku-5-5",
      usage: { inputTokens: 9943, outputTokens: 4 },
      limits: {
        status: "allowed",
        fiveHour: { utilization: 0.4, resetsAt: 1_793_538_600 },
        sevenDay: { utilization: 0.47, resetsAt: 1_793_599_200 },
        usingOverage: false,
        observedAt: NOW,
      },
    });
  });

  it("does not call a plan limited just because a window reads full, when the call still worked", () => {
    // What a plan with extra usage switched on reports: rejected and 100 percent, but the reply came back.
    const full = rateLimit({ status: "rejected", isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1_793_538_600 } } });
    const result = parseClaudeOutput([full, success].join("\n"), "claude", NOW);
    expect(result.text).toBe("ok");
    expect(result.limits).toMatchObject({ status: "rejected", usingOverage: true, fiveHour: { utilization: 1 } });
    expect(result.limits?.limitedUntil).toBeUndefined();
  });

  it("raises a limit error, with when it ends, when a request is refused for a full window", () => {
    const refused = line({ type: "result", is_error: true, result: "5-hour limit reached" });
    const full = rateLimit({ status: "rejected", unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1_793_538_600 }, seven_day: { utilization: 0.5, resetsAt: 1_793_599_200 } } });
    let caught: unknown;
    try {
      parseClaudeOutput([full, refused].join("\n"), "claude", NOW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ClaudeLimitError);
    expect((caught as ClaudeLimitError).limits.limitedUntil).toBe(1_793_538_600 * 1000);
  });

  it("waits a short while when a refusal names no time, and treats other failures as plain errors", () => {
    let caught: unknown;
    try {
      parseClaudeOutput(line({ type: "result", is_error: true, result: "You have hit your usage limit" }), "claude", NOW);
    } catch (err) {
      caught = err;
    }
    expect((caught as ClaudeLimitError).limits.limitedUntil).toBe(NOW + 15 * 60_000);

    const other = (): unknown => {
      return parseClaudeOutput(line({ type: "result", is_error: true, result: "model not found" }), "claude", NOW);
    };
    expect(other).toThrow("model not found");
    expect(other).not.toThrow(ClaudeLimitError);
  });

  it("still reads a single JSON object from an older program, with no plan information", () => {
    expect(parseClaudeOutput(line({ result: "hi", model: "claude-sonnet" }), "claude")).toEqual({ text: "hi", model: "claude-sonnet" });
  });

  it("reports an output with no result", () => {
    expect(() => {
      return parseClaudeOutput(line({ type: "system" }), "claude");
    }).toThrow("claude returned no result");
  });
});

describe("running the program", () => {
  it("asks for the stream, and returns what it read", async () => {
    const exec = vi.fn(() => {
      return Promise.resolve([rateLimit(), success].join("\n"));
    });
    const result = await runClaude("claude", { model: "claude:haiku", messages: [{ role: "user", content: "say ok" }] }, exec);
    expect(buildArgs({ model: "claude:haiku", messages: [] })).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--verbose"]));
    expect(result.text).toBe("ok");
    expect(result.limits?.sevenDay?.utilization).toBe(0.47);
  });
});
