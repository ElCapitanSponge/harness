import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: "@storybook/react-vite",
  // Same Tailwind and path alias as the app, without the gateway proxy or the compiler step.
  viteFinal: (viteConfig) => {
    return mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
    });
  },
};

export default config;
