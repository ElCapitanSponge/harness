import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/fields";

// What makes the app usable on a touchscreen, kept from quietly going away. The sizes cannot be measured in jsdom, which paints nothing,
// so these check what the code says: the classes that apply only where the browser reports a touchscreen (`pointer-coarse:`).
const sources = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx", "!./**/*.stories.tsx"], { eager: true, query: "?raw", import: "default" });

const linesWith = (matches: (line: string) => boolean): string[] => {
  const found: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    text.split("\n").forEach((line, index) => {
      if (matches(line)) {
        found.push(`${file}:${String(index + 1)}`);
      }
    });
  }
  return found;
};

describe("Touchscreens", () => {
  it("always shows what is hidden until hover, because a touchscreen has no hover", () => {
    expect(linesWith((line) => {
      return line.includes("opacity-0") && !line.includes("pointer-coarse:opacity-100");
    })).toEqual([]);
    expect(linesWith((line) => {
      return line.includes("group-hover") && !line.includes("pointer-coarse:");
    })).toEqual([]);
  });

  it("makes every size of button 44px on a touchscreen, whatever size a caller asks for", () => {
    const { container } = render(
      <>
        <Button size="default" className="h-6">a</Button>
        <Button size="sm" className="h-6">b</Button>
        <Button size="lg" className="h-6">c</Button>
        <Button size="icon" className="size-6" aria-label="d" />
      </>,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => {
      return b.classList.contains("pointer-coarse:h-11") || b.classList.contains("pointer-coarse:size-11");
    })).toEqual([true, true, true, true]);
    // The caller's own size still applies to a mouse.
    expect(buttons[0]?.classList.contains("h-6")).toBe(true);
  });

  it("makes fields 44px tall on a touchscreen", () => {
    const { getByLabelText } = render(
      <>
        <Input aria-label="text" />
        <Select aria-label="list" />
      </>,
    );
    expect(getByLabelText("text")).toHaveClass("pointer-coarse:h-11");
    expect(getByLabelText("list")).toHaveClass("pointer-coarse:h-11");
  });

  it("has the page shrink to what the on-screen keyboard leaves, so the message box stays in view", () => {
    expect(html).toContain("interactive-widget=resizes-content");
  });
});
