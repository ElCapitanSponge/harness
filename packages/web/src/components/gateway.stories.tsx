import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Seed } from "../../.storybook/preview";
import type { Catalogue, ConversationUsage, SessionInfo } from "@/lib/types";
import { ContextMeter } from "./ContextMeter";
import { ConversationActions } from "./ConversationActions";
import { ModelPicker } from "./ModelPicker";

// Components that read from the gateway, with the gateway's answers supplied by the story.

const catalogue: Catalogue = {
  models: [
    { id: "qwen3-coder-30b", device: "anakin", state: "loaded", contextLength: 32_768 },
    { id: "gemma-3-12b", device: "anakin", state: "loads-on-use" },
    { id: "llama-70b", device: "anakin", state: "cannot-load" },
    { id: "phi-4", device: "bastila", state: "busy", busyReason: "RocketLeague.exe" },
  ],
  claude: { available: true, device: "bastila", models: ["claude", "claude:sonnet"] },
};

const seed = (queries: Seed["queries"]): { seed: Seed } => {
  return { seed: { queries } };
};

export default { title: "Gateway/Pickers and meters" } satisfies Meta;

export const Models: StoryObj = {
  parameters: seed([[["catalogue"], catalogue]]),
  render: () => {
    return <div className="max-w-sm"><ModelPicker value="" onChange={fn()} /></div>;
  },
  play: async ({ canvasElement }) => {
    const picker = within(canvasElement).getByLabelText("Model");
    // The first usable model is chosen for you; ones that cannot run are listed but cannot be chosen.
    await expect(picker).toHaveValue("qwen3-coder-30b");
    await expect(within(picker).getByRole("option", { name: /llama-70b/ })).toBeDisabled();
    await expect(within(picker).getByRole("option", { name: /phi-4.*busy/ })).toBeDisabled();
  },
};

export const ModelsForCoding: StoryObj = {
  parameters: seed([[["catalogue"], catalogue]]),
  render: () => {
    return <div className="max-w-sm"><ModelPicker value="" onChange={fn()} excludeClaude /></div>;
  },
  play: async ({ canvasElement }) => {
    // A coding session cannot use Claude, so its models are listed but cannot be picked.
    await expect(within(canvasElement).getByRole("option", { name: "claude:sonnet" })).toBeDisabled();
  },
};

export const NoModels: StoryObj = {
  parameters: seed([[["catalogue"], { models: [], claude: { available: false, models: [] } } satisfies Catalogue]]),
  render: () => {
    return <div className="max-w-sm"><ModelPicker value="" onChange={fn()} /></div>;
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Model")).toBeDisabled();
  },
};

const usage = (over: Partial<NonNullable<ConversationUsage["last"]>>, models: ConversationUsage["byModel"] = []): ConversationUsage => {
  return {
    last: { model: "qwen3-coder-30b", device: "anakin", promptTokens: 6200, completionTokens: 400, contextLength: 32_768, estimated: false, ...over },
    byModel: models.length > 0 ? models : [{ model: "qwen3-coder-30b", device: "anakin", calls: 4, promptTokens: 21_000, completionTokens: 1800, estimated: false }],
  };
};

export const ContextHalfFull: StoryObj = {
  parameters: seed([[["usage", "conversation", "c1"], usage({})]]),
  render: () => {
    return <ContextMeter id="c1" />;
  },
  play: async ({ canvasElement }) => {
    const meter = within(canvasElement).getByRole("button", { name: /6\.6k/ });
    await expect(meter).toHaveTextContent("6.6k / 33k");
    await expect(within(canvasElement).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  },
};

export const ContextNearlyFull: StoryObj = {
  parameters: seed([[["usage", "conversation", "c2"], usage({ promptTokens: 30_000, completionTokens: 1500 })]]),
  render: () => {
    return <ContextMeter id="c2" />;
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "96");
  },
};

export const ContextEstimatedForClaude: StoryObj = {
  parameters: seed([[["usage", "conversation", "c3"], usage({ model: "claude", device: "bastila", contextLength: 200_000, estimated: true })]]),
  render: () => {
    return <ContextMeter id="c3" />;
  },
  play: async ({ canvasElement }) => {
    // A number from an estimate says so.
    await expect(within(canvasElement).getByRole("button", { name: /~6\.6k/ })).toHaveTextContent("~6.6k");
  },
};

const conversation: SessionInfo = { id: "c1", model: "qwen3-coder-30b", device: "", root: "", busy: false, events: 4, created: 0, updated: 0, kind: "chat", title: "Why the build fails", deviceConnected: true };

export const RenameAndDelete: StoryObj = {
  render: () => {
    return <ConversationActions info={conversation} />;
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Conversation actions" }));
    const menu = within(canvasElement.ownerDocument.body);
    await expect(await menu.findByRole("menuitem", { name: /rename/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /delete/i })).toBeVisible();
  },
};
