import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ClaudePlan } from "./ClaudeMeter";

// A fixed time, so the countdowns do not change under the story.
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const reset = (hours: number): number => {
  return Math.round((NOW + hours * 3_600_000) / 1000);
};

const meta = {
  title: "Claude/Plan",
  component: ClaudePlan,
  args: { at: NOW, status: { readable: false, available: true } },
  decorators: [
    (Story) => {
      return <div className="max-w-xs rounded-lg border bg-card p-3"><Story /></div>;
    },
  ],
} satisfies Meta<typeof ClaudePlan>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PartwayThrough: Story = {
  args: { status: { readable: true, available: true, device: "bastila", fiveHour: { utilization: 0.4, resetsAt: reset(2.2) }, sevenDay: { utilization: 0.47, resetsAt: reset(60) }, observedAt: NOW - 120_000 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("60% left, resets in 2h 12m")).toBeVisible();
    await expect(canvas.getByText("53% left, resets in 2d 12h")).toBeVisible();
    await expect(canvas.getByRole("progressbar", { name: "5-hour used" })).toHaveAttribute("aria-valuenow", "40");
  },
};

export const FullButUsingExtraUsage: Story = {
  args: { status: { readable: true, available: true, device: "bastila", usingOverage: true, fiveHour: { utilization: 1, resetsAt: reset(1) }, sevenDay: { utilization: 0.47, resetsAt: reset(60) } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A full window is not a refusal: the plan has extra usage, and the page says so instead of calling Claude unavailable.
    await expect(canvas.getByText("0% left, resets in 1h 0m")).toBeVisible();
    await expect(canvas.getByText("Using extra usage.")).toBeVisible();
    await expect(canvas.queryByText(/Limited until/)).toBeNull();
  },
};

export const Limited: Story = {
  args: { status: { readable: true, available: false, device: "bastila", limitedUntil: NOW + 90 * 60_000, fiveHour: { utilization: 1, resetsAt: reset(1.5) }, sevenDay: { utilization: 0.9, resetsAt: reset(30) } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Limited until .* \(1h 30m\)\. Using local models\./)).toBeVisible();
  },
};

export const NotReadYet: Story = {
  args: { status: { readable: false, available: true, device: "bastila" } },
  play: async ({ canvasElement }) => {
    // With nothing to go on the page says so, rather than showing numbers it does not have.
    await expect(within(canvasElement).getByText(/Not read yet/)).toBeVisible();
    await expect(within(canvasElement).queryByRole("progressbar")).toBeNull();
  },
};
