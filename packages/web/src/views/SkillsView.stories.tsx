import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { Seed } from "../../.storybook/preview";
import type { SkillsFolder } from "@/lib/types";
import { SkillsView } from "./SkillsView";

export default { title: "Pages/Skills", parameters: { layout: "padded" } } satisfies Meta;

const seed = (queries: Seed["queries"]): { seed: Seed } => {
  return { seed: { queries } };
};

const folders: SkillsFolder[] = [
  {
    device: "anakin",
    root: "personal",
    instructions: [{ source: "your own CLAUDE.md", length: 820 }, { source: "AGENTS.md", length: 2400 }],
    skills: [
      { name: "tdd", description: "Test-driven development. Use when the user wants to build features or fix bugs test-first.", hint: "[what to build]", length: 5200, modelInvocable: true, source: "user" },
      { name: "triage", description: "Sort the issues in the tracker.", length: 1900, modelInvocable: false, source: "user" },
      { name: "release", description: "Cut a release of this project.", length: 800, modelInvocable: true, source: "personal" },
    ],
    skipped: [{ path: "C:\\Users\\andre\\.claude\\skills\\broken\\SKILL.md", reason: "the front matter has no description" }],
  },
  { device: "bastila", root: "notes", instructions: [], skills: [], skipped: [], note: "tool \"project_context\" is not allowed on this device" },
];

export const SkillsByDevice: StoryObj = {
  parameters: seed([[["skills", "", ""], folders], [["library"], [{ name: "wizard", description: "Walk through steps only you can do.", length: 1500, modelInvocable: true, source: "library", files: 3, bytes: 4096 }]]]),
  render: () => {
    return <SkillsView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const anakin = await canvas.findByRole("region", { name: "anakin: personal" });
    await expect(within(anakin).getByText("/tdd")).toBeVisible();
    // The ones only the person starts say so, every skill shows how long it is, and a skipped one gives its reason.
    await expect(within(anakin).getByText("you start it")).toBeVisible();
    await expect(within(anakin).getByText("5.2k characters")).toBeVisible();
    await expect(within(anakin).getByText("the front matter has no description")).toBeVisible();
    await expect(within(anakin).getByText("AGENTS.md")).toBeVisible();
    await expect(within(canvas.getByRole("region", { name: "bastila: notes" })).getByText(/could not list its skills/)).toBeVisible();
  },
};

export const NoDevices: StoryObj = {
  parameters: seed([[["skills", "", ""], []], [["library"], []]]),
  render: () => {
    return <SkillsView />;
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No device with a project folder is connected.")).toBeVisible();
  },
};
