import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { Seed } from "../../.storybook/preview";
import type { InstructionEntry, InstructionFile } from "@/lib/types";
import { ProjectMemory } from "./ProjectMemory";

export default { title: "Components/ProjectMemory", component: ProjectMemory, parameters: { layout: "padded" } } satisfies Meta<typeof ProjectMemory>;

const seed = (queries: Seed["queries"]): { seed: Seed } => {
  return { seed: { queries } };
};

const agents: InstructionFile = { name: "AGENTS.md", exists: true, text: "# AGENTS.md\n\nUse pnpm. Run `pnpm test` before pushing.\n", version: "1730797000000-52" };

const both: InstructionEntry[] = [{ name: "AGENTS.md", exists: true, length: 2400 }, { name: "CLAUDE.md", exists: true, length: 12 }];

// The panel is a narrow column, so the section is shown at its width.
const render = () => {
  return <div className="w-80"><ProjectMemory id="s1" /></div>;
};

export const TwoFiles: StoryObj = {
  parameters: seed([[["instructions", "s1"], both]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: /AGENTS\.md.*2400 characters/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /CLAUDE\.md.*12 characters/ })).toBeVisible();
    // It says when a saved change applies.
    await expect(canvas.getByText(/applies from your next message/)).toBeVisible();
  },
};

export const OpenForEditing: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /AGENTS\.md/ }));
    const box = await canvas.findByRole<HTMLTextAreaElement>("textbox", { name: "AGENTS.md text" });
    await expect(box.value).toContain("Use pnpm.");
    // Nothing to save until it is changed.
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(box, " More.");
    await expect(canvas.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(canvas.getByText("Unsaved changes")).toBeVisible();
  },
};

export const NoFileYet: StoryObj = {
  parameters: seed([
    [["instructions", "s1"], [{ name: "AGENTS.md", exists: false }, { name: "CLAUDE.md", exists: false }] satisfies InstructionEntry[]],
    [["instruction", "s1", "AGENTS.md"], { name: "AGENTS.md", exists: false, text: "", version: "absent" } satisfies InstructionFile],
  ]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("This project has no instruction file yet.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Create AGENTS\.md/ }));
    await expect(await canvas.findByText("AGENTS.md (new)")).toBeVisible();
  },
};

export const OneTooLongToOpen: StoryObj = {
  parameters: seed([[["instructions", "s1"], [{ name: "AGENTS.md", exists: true, length: 900 }, { name: "CLAUDE.md", note: "CLAUDE.md is too long to edit here (30000 characters); edit it on the device" }] satisfies InstructionEntry[]]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/CLAUDE\.md is too long to edit here/)).toBeVisible();
    // The file that can be opened still can.
    await expect(canvas.getByRole("button", { name: /AGENTS\.md/ })).toBeVisible();
  },
};

export const OnAPhone: StoryObj = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: seed([[["instructions", "s1"], both]]),
  render,
  play: async ({ canvasElement }) => {
    const row = await within(canvasElement).findByRole("button", { name: /AGENTS\.md/ });
    // The test run lays nothing out, so a touch target's size is checked on the component's own test; here it is for looking at.
    await expect(row).toBeVisible();
  },
};
