import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SentAt } from "./SentAt";

describe("SentAt", () => {
  it("shows nothing when there is no time", () => {
    const { container } = render(<SentAt at={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the time with the full date and zone on hover, and the exact moment for machines", () => {
    const at = Date.parse("2025-03-04T10:15:00Z");
    const { container } = render(<SentAt at={at} />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2025-03-04T10:15:00.000Z");
    expect(time?.getAttribute("title")).toContain("2025");
    expect(time?.textContent).toContain("2025");
  });

  it("can be reached from the keyboard and says what it is", () => {
    const { container } = render(<SentAt at={Date.parse("2025-03-04T10:15:00Z")} label="Queued" />);
    const time = container.querySelector("time");
    expect(time?.tabIndex).toBe(0);
    expect(time?.getAttribute("aria-label")).toMatch(/^Queued /);
  });
});
