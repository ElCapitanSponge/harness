import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import type { Seed } from "../../.storybook/preview";
import type { InstructionEntry, InstructionFile } from "@/lib/types";
import { ProjectMemory } from "./ProjectMemory";

export default { title: "Components/ProjectMemory", component: ProjectMemory, parameters: { layout: "padded" } } satisfies Meta<typeof ProjectMemory>;

const seed = (queries: Seed["queries"]): { seed: Seed } => {
  return { seed: { queries } };
};

const agents: InstructionFile = { name: "AGENTS.md", exists: true, text: "# AGENTS.md\n\nUse pnpm. Run `pnpm test` before pushing.\n", version: "1730797000000-52" };

const both: InstructionEntry[] = [{ name: "AGENTS.md", exists: true, length: 2400 }, { name: "CLAUDE.md", exists: true, length: 12 }];

const olderAgent = "This device runs an older agent that cannot read or save instruction files. Update the agent on it.";

// The panel is a narrow column, so the section is shown at its width.
const render = () => {
  return <div className="w-80"><ProjectMemory id="s1" /></div>;
};

const reply = (status: number, body: unknown): Promise<Response> => {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
};

// A request that a story's data does not cover is answered here, so nothing reaches a network, and the real fetch is put back afterwards.
const answering = (handler: (path: string, method: string) => Promise<Response>): (() => () => void) => {
  return () => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return handler(url, init?.method ?? "GET");
    };
    return () => {
      globalThis.fetch = original;
    };
  };
};

// Never answers, to show a request that is still going.
const waiting = (): Promise<Response> => {
  return new Promise<Response>(() => {
    return undefined;
  });
};

// Opens AGENTS.md and types into it, which every story that saves starts with.
const editAgents = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: /AGENTS\.md/ }));
  await userEvent.type(await canvas.findByRole("textbox", { name: "AGENTS.md text" }), " More.");
  return canvas;
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

export const Loading: StoryObj = {
  beforeEach: answering(waiting),
  render,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("status")).toHaveTextContent("Looking for instruction files");
  },
};

export const DeviceUnreachable: StoryObj = {
  beforeEach: answering(() => {
    return reply(503, { error: { message: "Could not reach the device: not connected" } });
  }),
  render,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("alert")).toHaveTextContent("Could not reach the device");
  },
};

export const AnOlderAgent: StoryObj = {
  parameters: seed([[["instructions", "s1"], [{ name: "AGENTS.md", note: olderAgent }, { name: "CLAUDE.md", note: olderAgent }] satisfies InstructionEntry[]]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Said once, and it does not claim there is no file: the device could not look.
    await expect(await canvas.findByText(/runs an older agent/)).toBeVisible();
    await expect(canvas.queryByText("This project has no instruction file yet.")).toBeNull();
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

export const Saving: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  beforeEach: answering(waiting),
  render,
  play: async ({ canvasElement }) => {
    const canvas = await editAgents(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByRole("button", { name: "Saving…" })).toBeDisabled();
  },
};

export const Saved: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  beforeEach: answering((path, method) => {
    if (method === "PUT") {
      return reply(200, { saved: true, version: "1730797000001-58", length: 58 });
    }
    if (path.endsWith("/AGENTS.md")) {
      return reply(200, { ...agents, text: `${agents.text} More.`, version: "1730797000001-58" });
    }
    return reply(200, both);
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = await editAgents(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    // It says when the change applies.
    await expect(await canvas.findByText(/Your next message in this conversation is sent with the new text/)).toBeVisible();
  },
};

export const FileChangedOnTheDevice: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  beforeEach: answering(() => {
    return reply(409, { error: { message: "AGENTS.md changed on disk after you opened it; reload it to see what changed" }, conflict: true, version: "1730797009999-61" });
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = await editAgents(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText(/changed on disk after you opened it/)).toBeVisible();
    // What was typed is kept, and the person chooses when to reload.
    await expect(canvas.getByText(/Your text is still here/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Reload from the device" })).toBeVisible();
    await expect(canvas.getByRole<HTMLTextAreaElement>("textbox", { name: "AGENTS.md text" }).value).toContain("More.");
  },
};

export const RefusedInAReadOnlyFolder: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  beforeEach: answering(() => {
    return reply(403, { error: { message: "project root \"proj\" is read-only on this device, so write_instruction is not allowed there" } });
  }),
  render,
  play: async ({ canvasElement }) => {
    const canvas = await editAgents(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText(/is read-only on this device/)).toBeVisible();
    // Reloading would not help, so it is not offered.
    await expect(canvas.queryByRole("button", { name: "Reload from the device" })).toBeNull();
  },
};

export const TooLongToSave: StoryObj = {
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /AGENTS\.md/ }));
    // Each line break is two characters once it is sent, so this is over the limit though it is not 20,000 characters.
    await fireEvent.change(await canvas.findByRole("textbox", { name: "AGENTS.md text" }), { target: { value: "\n".repeat(11_000) } });
    await expect(await canvas.findByText(/too long to save from here/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
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
  parameters: seed([[["instructions", "s1"], both], [["instruction", "s1", "AGENTS.md"], agents]]),
  render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The test run lays nothing out, so a touch target's size is checked in the component's own test; here it is for looking at.
    await userEvent.click(await canvas.findByRole("button", { name: /AGENTS\.md/ }));
    await expect(await canvas.findByRole("textbox", { name: "AGENTS.md text" })).toBeVisible();
  },
};
