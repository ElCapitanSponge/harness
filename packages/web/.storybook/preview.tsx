import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Preview } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";
import "../src/index.css";
import { setKey } from "../src/lib/api";

// Data a story gives the components that read from the gateway, keyed as the app keys its queries.
export interface Seed {
  queries?: [readonly unknown[], unknown][];
}

// A story that brings its own router (to show a route that fails, say) sets `parameters.ownRouter`.
const Frame = ({ seed, dark, ownRouter, children }: { seed: Seed; dark: boolean; ownRouter: boolean; children: React.ReactNode }) => {
  const [client] = useState(() => {
    const created = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
    for (const [key, data] of seed.queries ?? []) {
      created.setQueryData(key, data);
    }
    return created;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <QueryClientProvider client={client}>
      {ownRouter
        ? <div className="bg-background text-foreground">{children}</div>
        : (
            <MemoryRouter>
              <div className="bg-background p-4 text-foreground">{children}</div>
            </MemoryRouter>
          )}
    </QueryClientProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i } },
    // The two phone sizes the app is checked at; a story picks one with `globals: { viewport: { value: "phone", isRotated: false } }`.
    viewport: {
      options: {
        phone: { name: "Phone 375x667", type: "mobile", styles: { width: "375px", height: "667px" } },
        phoneTall: { name: "Phone 390x844", type: "mobile", styles: { width: "390px", height: "844px" } },
      },
    },
  },
  globalTypes: {
    theme: { description: "Theme", toolbar: { title: "Theme", icon: "paintbrush", items: ["light", "dark"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      // A key so components that ask the gateway have something to send; nothing here reaches a network.
      setKey("storybook");
      const seed = (context.parameters.seed ?? {}) as Seed;
      return (
        <Frame seed={seed} dark={context.globals.theme === "dark"} ownRouter={context.parameters.ownRouter === true}>
          <Story />
        </Frame>
      );
    },
  ],
};

export default preview;
