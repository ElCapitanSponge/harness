import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import preview from "../.storybook/preview";

// Every story is also a test: it is rendered, its interaction (`play`) is run, and the result is checked for accessibility
// problems. The expectations live in the stories, next to what they show.
setProjectAnnotations([preview]);

interface Runnable {
  run: (options: { canvasElement: HTMLElement }) => Promise<void>;
}

const modules = import.meta.glob("./**/*.stories.tsx", { eager: true });

describe.each(Object.entries(modules))("%s", (_file, module) => {
  const composed = composeStories(module as Parameters<typeof composeStories>[0]) as unknown as Record<string, Runnable>;
  const stories = Object.entries(composed);

  it.each(stories)("%s", async (_name, Story) => {
    // Each story gets its own container, so what one leaves behind never reaches the next.
    const canvasElement = document.body.appendChild(document.createElement("div"));
    try {
      await Story.run({ canvasElement });
      // Colour contrast needs real layout and painted colours, which jsdom does not have; the Storybook a11y panel checks it.
      const results = await axe.run(canvasElement, { rules: { "color-contrast": { enabled: false } } });
      const serious = results.violations.filter((v) => {
        return v.impact === "serious" || v.impact === "critical";
      });
      expect(serious.map((v) => {
        return `${v.id}: ${v.help} (${v.nodes[0]?.html.slice(0, 80) ?? ""})`;
      })).toEqual([]);
    } finally {
      canvasElement.remove();
    }
  });
});
