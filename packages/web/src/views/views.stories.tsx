import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { Seed } from "../../.storybook/preview";
import type { NodeRecord, SettingsReport, UsageSummary } from "@/lib/types";
import { DevicesView } from "./DevicesView";
import { UsageView } from "./UsageView";

export default { title: "Pages/Devices and usage", parameters: { layout: "padded" } } satisfies Meta;

const node = (over: Partial<NodeRecord> & { nodeId: string }): NodeRecord => {
  return { kind: "local", busy: false, models: [{ id: "qwen3-coder-30b", loaded: true }], platform: "win32", lastSeen: Date.now(), ...over };
};

const report = (over: Partial<SettingsReport> = {}): SettingsReport => {
  return {
    settings: { projectRoots: { personal: "C:\\Users\\andre\\personal" }, allowedTools: ["read_file", "list_dir", "grep"], modelControl: true, claude: true, gameProcesses: ["RocketLeague.exe"] },
    sources: { projectRoots: "file", allowedTools: "default", modelControl: "file", claude: "file", gameProcesses: "default" },
    locked: [],
    remoteConfig: true,
    tools: [
      { name: "read_file", installed: true, asksFirst: false },
      { name: "write_file", installed: true, asksFirst: true },
      { name: "web_fetch", installed: true, asksFirst: true },
      { name: "git_read", installed: true, asksFirst: false },
      { name: "git_write", installed: true, asksFirst: true },
      { name: "gh_read", installed: false, asksFirst: false },
    ],
    ...over,
  };
};

const seed = (queries: Seed["queries"]): { seed: Seed } => {
  return { seed: { queries } };
};

export const DeviceThatAcceptsChanges: StoryObj = {
  parameters: seed([[["nodes"], [node({ nodeId: "anakin" })]], [["settings", "anakin"], report()]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("This device accepts settings changes from here.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save settings" })).toBeEnabled();
    await expect(canvas.getByRole("checkbox", { name: /^read_file/ })).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: /^write_file/ })).not.toBeChecked();
    // A tool that changes things says it asks first, and one whose program is missing says so and cannot be switched on.
    await expect(canvas.getAllByText("asks first").length).toBeGreaterThan(0);
    await expect(canvas.getByText("not installed")).toBeVisible();
    await expect(canvas.getByRole("checkbox", { name: /gh_read/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole("checkbox", { name: /^write_file/ }));
    await expect(canvas.getByRole("checkbox", { name: /^write_file/ })).toBeChecked();
  },
};

export const ReadOnlyDevice: StoryObj = {
  parameters: seed([[["nodes"], [node({ nodeId: "mac", platform: "darwin" })]], [["settings", "mac"], report({ remoteConfig: false })]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Read-only: start its agent with REMOTE_CONFIG=1/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Save settings" })).toBeNull();
    await expect(canvas.getByRole("checkbox", { name: /^read_file/ })).toBeDisabled();
  },
};

export const SettingFixedByTheEnvironment: StoryObj = {
  parameters: seed([[["nodes"], [node({ nodeId: "anakin" })]], [["settings", "anakin"], report({ locked: ["claude"], sources: { projectRoots: "file", allowedTools: "default", modelControl: "file", claude: "env", gameProcesses: "default" } })]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/fixed by CLAUDE_ENABLED/)).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Claude" })).toBeDisabled();
    await expect(canvas.getByRole("switch", { name: "Model control" })).toBeEnabled();
  },
};

export const NoDevices: StoryObj = {
  parameters: seed([[["nodes"], []]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No device is connected.")).toBeVisible();
  },
};

const summary: UsageSummary = {
  days: 7,
  since: 0,
  calls: 12,
  promptTokens: 41_000,
  completionTokens: 5200,
  byModel: [
    { model: "qwen3-coder-30b", device: "anakin", calls: 8, promptTokens: 30_000, completionTokens: 4000, estimated: false },
    { model: "claude", device: "bastila", calls: 4, promptTokens: 11_000, completionTokens: 1200, estimated: true },
  ],
  byDevice: [
    { device: "anakin", calls: 8, promptTokens: 30_000, completionTokens: 4000 },
    { device: "bastila", calls: 4, promptTokens: 11_000, completionTokens: 1200 },
  ],
  byDay: [
    { day: "2026-10-30", model: "qwen3-coder-30b", tokens: 14_000 },
    { day: "2026-10-30", model: "claude", tokens: 4000 },
    { day: "2026-10-31", model: "qwen3-coder-30b", tokens: 20_000 },
    { day: "2026-11-01", model: "claude", tokens: 8200 },
  ],
};

export const UsageOverAWeek: StoryObj = {
  parameters: seed([[["usage", "summary", 7, -new Date().getTimezoneOffset()], summary]]),
  render: () => {
    return <UsageView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Tokens in")).toBeVisible();
    // The Claude row is an estimate, and the page says what ~ means.
    await expect(canvas.getByText(/starting with ~ includes estimates/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  },
};
