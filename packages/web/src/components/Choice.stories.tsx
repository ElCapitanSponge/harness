import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Choice, type ChoiceGroup } from "./ui/choice";

// The pick-one list behind the model, mode and effort pickers: a label on the button, and in the list a second line and a badge.

export default { title: "Components/Choice" } satisfies Meta;

const Demo = ({ groups, start, disabled = false, className = "max-w-sm" }: { groups: ChoiceGroup[]; start: string; disabled?: boolean; className?: string }) => {
  const [value, setValue] = useState(start);
  return <div className={className}><Choice label="Pick one" groups={groups} value={value} disabled={disabled} onValueChange={setValue} /></div>;
};

const body = (canvasElement: HTMLElement) => {
  return within(canvasElement.ownerDocument.body);
};

const modes: ChoiceGroup[] = [{
  options: [
    { value: "ask", label: "Ask before every change", detail: "The default." },
    { value: "plan", label: "Plan first", detail: "The model can only read until you approve its plan." },
    { value: "bypass", label: "Run without asking", detail: "Nothing asks. The device's own allow list still applies.", badge: "risky", badgeTone: "warning" },
  ],
}];

export const SubtitleAndBadge: StoryObj = {
  render: () => {
    return <Demo groups={modes} start="ask" />;
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("combobox", { name: "Pick one" });
    // The button shows only the label; the second line and the badge are in the list, visible without hovering.
    await expect(button).toHaveTextContent("Ask before every change");
    await userEvent.click(button);
    const list = body(canvasElement);
    await expect(list.getByRole("option", { name: "Plan first" })).toHaveAccessibleDescription("The model can only read until you approve its plan.");
    await expect(within(list.getByRole("option", { name: "Run without asking" })).getByText("risky")).toBeInTheDocument();
    await userEvent.click(list.getByRole("option", { name: "Plan first" }));
    await expect(button).toHaveTextContent("Plan first");
  },
};

export const LongText: StoryObj = {
  render: () => {
    return (
      <Demo
        className="w-56"
        start="long"
        groups={[{ options: [
          { value: "long", label: "A model with a really quite long name, version 2026-11-03-preview", detail: "A long second line that has to wrap onto more rows rather than push the list wider than the screen" },
          { value: "short", label: "Short" },
        ] }]}
      />
    );
  },
  play: async ({ canvasElement }) => {
    // The button cuts a long label short; the list wraps it, so nothing is lost.
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Pick one" }));
    await expect(body(canvasElement).getByRole("option", { name: /really quite long name/ })).toHaveAccessibleDescription(/has to wrap onto more rows/);
  },
};

export const DisabledOptionsSayWhy: StoryObj = {
  render: () => {
    return (
      <Demo
        start="a"
        groups={[{ options: [
          { value: "a", label: "Ready", detail: "Loaded" },
          { value: "b", label: "Busy one", detail: "Busy (RocketLeague.exe)", disabled: true },
          { value: "c", label: "Too big", detail: "20 GB, too big while Teams is running", disabled: true },
        ] }]}
      />
    );
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Pick one" }));
    const busy = body(canvasElement).getByRole("option", { name: "Busy one" });
    await expect(busy).toHaveAttribute("aria-disabled", "true");
    await expect(busy).toHaveAccessibleDescription("Busy (RocketLeague.exe)");
    await userEvent.click(busy);
    // Choosing a disabled option does nothing, and the list stays open.
    await expect(body(canvasElement).getByRole("listbox")).toBeInTheDocument();
  },
};

export const WholeControlDisabled: StoryObj = {
  render: () => {
    return <Demo groups={modes} start="ask" disabled />;
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("combobox", { name: "Pick one" })).toBeDisabled();
  },
};

const many: ChoiceGroup[] = [{
  options: Array.from({ length: 40 }, (_, index) => {
    return { value: `m${String(index)}`, label: `Model ${String(index + 1)}`, detail: index % 5 === 0 ? "Loads when used" : "Loaded" };
  }),
}];

export const ManyItems: StoryObj = {
  render: () => {
    return <Demo groups={many} start="m0" />;
  },
  play: async ({ canvasElement }) => {
    // A long list scrolls inside the panel instead of running off the screen.
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Pick one" }));
    await expect(body(canvasElement).getAllByRole("option")).toHaveLength(40);
  },
};

export const PhoneWidth: StoryObj = {
  render: () => {
    return <Demo groups={modes} start="ask" className="w-80" />;
  },
  play: async ({ canvasElement }) => {
    // On a narrow screen the rows are tall enough to tap, and the list never grows wider than the screen.
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Pick one" }));
    await expect(body(canvasElement).getAllByRole("option")).toHaveLength(3);
  },
};
