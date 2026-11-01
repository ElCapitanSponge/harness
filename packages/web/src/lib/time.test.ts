import { describe, expect, it } from "vitest";
import { timeUntil } from "./time";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe("timeUntil", () => {
  it("counts down in minutes, then hours and minutes, then days", () => {
    expect(timeUntil(NOW + 35 * MIN, NOW)).toBe("35m");
    expect(timeUntil(NOW + 130 * MIN, NOW)).toBe("2h 10m");
    expect(timeUntil(NOW + 50 * 60 * MIN, NOW)).toBe("2d 2h");
  });

  it("says now for a time that has come", () => {
    expect(timeUntil(NOW - 5 * MIN, NOW)).toBe("now");
    expect(timeUntil(NOW + 20_000, NOW)).toBe("now");
  });
});
