import { describe, expect, it } from "vitest";
import { sentTime } from "./format";

const opts = { locale: "en-GB", timeZone: "UTC" };
const now = Date.parse("2026-11-05T12:00:00Z");

describe("sentTime", () => {
  it("shows the time only for today", () => {
    const t = sentTime(Date.parse("2026-11-05T14:32:00Z"), now, opts);
    expect(t?.text).toBe("14:32");
  });

  it("adds the date for an earlier day", () => {
    expect(sentTime(Date.parse("2026-11-03T14:32:00Z"), now, opts)?.text).toBe("3 Nov, 14:32");
  });

  it("adds the year when it is not this one", () => {
    expect(sentTime(Date.parse("2025-11-03T14:32:00Z"), now, opts)?.text).toBe("3 Nov 2025, 14:32");
  });

  it("gives the full date and time with the zone, and an ISO value", () => {
    const t = sentTime(Date.parse("2026-11-05T14:32:00Z"), now, opts);
    expect(t?.full).toContain("2026");
    expect(t?.full).toContain("UTC");
    expect(t?.iso).toBe("2026-11-05T14:32:00.000Z");
  });

  it("uses the zone to decide what is today", () => {
    // 23:30 UTC on the 4th is 10:30 on the 5th in Sydney, which is the same day as noon UTC (23:00 on the 5th there).
    const t = sentTime(Date.parse("2026-11-04T23:30:00Z"), now, { locale: "en-GB", timeZone: "Australia/Sydney" });
    expect(t?.text).toBe("10:30");
  });

  it("uses the 24-hour clock in every language, with midnight as 00", () => {
    expect(sentTime(Date.parse("2026-11-05T14:32:00Z"), now, { locale: "en-US", timeZone: "UTC" })?.text).toBe("14:32");
    expect(sentTime(Date.parse("2026-11-05T00:05:00Z"), now, { locale: "en-US", timeZone: "UTC" })?.text).toBe("00:05");
  });

  it("shows nothing when there is no time or it is not a time", () => {
    expect(sentTime(undefined, now, opts)).toBeUndefined();
    expect(sentTime(Number.NaN, now, opts)).toBeUndefined();
    expect(sentTime(Number.POSITIVE_INFINITY, now, opts)).toBeUndefined();
  });
});
