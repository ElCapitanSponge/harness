import { expect } from "vitest";

// Stored events carry `at`, the time the gateway recorded them, which a test cannot know. These matchers compare an event without it, so a stray or
// missing field still fails; the time itself is checked in times.test.ts.
const withoutAt = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => {
      return withoutAt(item);
    });
  }
  if (typeof value === "object" && value !== null && "at" in value && typeof value.at === "number") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => {
      return key !== "at";
    }));
  }
  return value;
};

expect.extend({
  toEqualEvents(received: unknown, expected: unknown) {
    const actual = withoutAt(received);
    return { pass: this.equals(actual, expected), message: () => {
      return "expected the events to be equal, ignoring their times";
    }, actual, expected };
  },
  toContainEvent(received: unknown, expected: unknown) {
    const events = Array.isArray(received)
      ? received.map((item: unknown) => {
          return withoutAt(item);
        })
      : [];
    return {
      pass: events.some((event) => {
        return this.equals(event, expected);
      }),
      message: () => {
        return "expected the events to contain this one, ignoring times";
      },
    };
  },
});

declare module "vitest" {
  interface Assertion {
    toEqualEvents: (expected: unknown) => void;
    toContainEvent: (expected: unknown) => void;
  }
}
