import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RouteError } from "./RouteError";

export default { title: "Pages/Error screen", parameters: { layout: "fullscreen", ownRouter: true } } satisfies Meta;

// A route that fails while drawing, so the error screen is what is shown.
const Broken = () => {
  throw new Error("Cannot read properties of undefined (reading 'includes')");
};

export const AFailedPage: StoryObj = {
  render: () => {
    const router = createMemoryRouter([{ path: "/", element: <Broken />, errorElement: <RouteError /> }]);
    return <div className="h-96"><RouterProvider router={router} /></div>;
  },
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole("alert");
    // The same card as the sign-in screen: the logo, what happened in words, the cause, and the way out.
    await expect(within(alert).getByText("Torii")).toBeVisible();
    await expect(within(alert).getByText("This page could not be shown")).toBeVisible();
    await expect(within(alert).getByText(/reading 'includes'/)).toBeVisible();
    await expect(within(alert).getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(within(alert).getByRole("button", { name: "Back to start" })).toBeVisible();
  },
};
