import { beforeEach, describe, expect, it } from "vitest";
import { setTheme, themeStore } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the theme", () => {
  it("puts dark on the page and remembers the choice", () => {
    setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("harness-theme")).toBe("dark");
    expect(themeStore.state).toBe("dark");
  });

  it("takes dark off again for light, and follows the system for system", () => {
    setTheme("dark");
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // The test setup reports a system that prefers light.
    setTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
