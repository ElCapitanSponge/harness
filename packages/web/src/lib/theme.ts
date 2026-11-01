import { Store } from "@tanstack/store";

export type Theme = "system" | "light" | "dark";

const NAME = "harness-theme";

const read = (): Theme => {
  try {
    const value = localStorage.getItem(NAME);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
};

export const themeStore = new Store<Theme>(read());

const apply = (theme: Theme): void => {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
};

export const setTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(NAME, theme);
  } catch {
    // Not remembered; the choice still applies until the tab closes.
  }
  themeStore.setState(() => {
    return theme;
  });
  apply(theme);
};

export const startTheme = (): void => {
  apply(themeStore.state);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    apply(themeStore.state);
  });
};
