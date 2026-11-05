import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SentAt } from "./SentAt";

const at = Date.parse("2025-03-04T10:15:00Z");

describe("SentAt", () => {
  it("shows nothing when there is no time", () => {
    const { container } = render(<SentAt at={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the short time, with the exact moment for machines and the full value as a tooltip", () => {
    const { container } = render(<SentAt at={at} />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2025-03-04T10:15:00.000Z");
    expect(time?.textContent).toContain("2025");
    expect(screen.getByRole("button").getAttribute("title")).toContain("2025");
  });

  it("shows the full date, time and zone when tapped, and the short time again when tapped again", async () => {
    const { container } = render(<SentAt at={at} />);
    const button = screen.getByRole("button");
    const short = container.querySelector("time")?.textContent;
    await userEvent.click(button);
    expect(container.querySelector("time")?.textContent).toBe(button.getAttribute("title"));
    await userEvent.click(button);
    expect(container.querySelector("time")?.textContent).toBe(short);
  });

  it("shows the full value when reached with the keyboard, and the short time when focus leaves", async () => {
    const { container } = render(<SentAt at={at} />);
    const short = container.querySelector("time")?.textContent;
    await userEvent.tab();
    expect(container.querySelector("time")?.textContent).toBe(screen.getByRole("button").getAttribute("title"));
    await userEvent.tab();
    expect(container.querySelector("time")?.textContent).toBe(short);
  });

  it("says what it is to a screen reader", () => {
    render(<SentAt at={at} label="Queued" />);
    expect(screen.getByRole("button", { name: /^Queued .*2025/ })).toBeTruthy();
  });
});
