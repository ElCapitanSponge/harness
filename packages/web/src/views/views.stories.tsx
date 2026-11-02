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
    settings: { projectRoots: { personal: "C:\\Users\\andre\\personal", work: "C:\\Users\\andre\\work" }, readOnlyRoots: ["work"], onDeviceTools: "read", remoteTools: "off", modelControl: true, claude: true, gameProcesses: ["RocketLeague.exe"], idleUnloadMinutes: 20, limitedProcesses: [], limitedMaxGb: 8, skillFolders: [] },
    sources: { projectRoots: "file", readOnlyRoots: "file", onDeviceTools: "default", remoteTools: "default", modelControl: "file", claude: "file", gameProcesses: "default", idleUnloadMinutes: "default", limitedProcesses: "default", limitedMaxGb: "default", skillFolders: "default" },
    locked: [],
    remoteConfig: true,
    tools: [
      { name: "read_file", group: "device", level: "read", installed: true, asksFirst: false },
      { name: "write_file", group: "device", level: "change", installed: true, asksFirst: true },
      { name: "git_read", group: "device", level: "read", installed: true, asksFirst: false },
      { name: "git_write", group: "device", level: "change", installed: true, asksFirst: true },
      { name: "web_fetch", group: "remote", level: "read", installed: true, asksFirst: true },
      { name: "gh_read", group: "remote", level: "read", installed: false, asksFirst: false },
      { name: "gh_write", group: "remote", level: "change", installed: false, asksFirst: true },
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

    // Two groups of tools, each off, read-only or able to change things.
    const onDevice = canvas.getByRole("radiogroup", { name: "Tools on this device" });
    const remote = canvas.getByRole("radiogroup", { name: "Tools that reach out" });
    await expect(within(onDevice).getByRole("radio", { name: "Read-only" })).toHaveAttribute("aria-checked", "true");
    await expect(within(remote).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    // A tool that changes things says it asks first, and one whose program is missing says so.
    await expect(canvas.getAllByText("asks first").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("not installed").length).toBeGreaterThan(0);
    await userEvent.click(within(onDevice).getByRole("radio", { name: "Can change" }));
    await expect(within(onDevice).getByRole("radio", { name: "Can change" })).toHaveAttribute("aria-checked", "true");
  },
};

export const AgentOlderThanThePage: StoryObj = {
  // An agent started before these settings existed sends a report without them. The page says so; it does not crash.
  parameters: seed([[["nodes"], [node({ nodeId: "anakin" })]], [["settings", "anakin"], { settings: { projectRoots: {}, allowedTools: ["read_file"], modelControl: false, claude: false, gameProcesses: [] }, sources: {}, locked: [], remoteConfig: true }]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/is older than this page/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Save settings" })).toBeNull();
  },
};

export const FolderThatCanOnlyBeRead: StoryObj = {
  parameters: seed([[["nodes"], [node({ nodeId: "anakin" })]], [["settings", "anakin"], report()]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // One folder is marked read-only and the other is not, and either can be switched.
    const work = await canvas.findByRole("switch", { name: "work is read-only" });
    const personal = canvas.getByRole("switch", { name: "personal is read-only" });
    await expect(work).toBeChecked();
    await expect(personal).not.toBeChecked();
    await userEvent.click(personal);
    await expect(personal).toBeChecked();
    await userEvent.click(work);
    await expect(work).not.toBeChecked();
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
    await expect(within(canvas.getByRole("radiogroup", { name: "Tools on this device" })).getByRole("radio", { name: "Can change" })).toBeDisabled();
    await expect(canvas.getByRole("switch", { name: "work is read-only" })).toBeDisabled();
  },
};

export const SettingFixedByTheEnvironment: StoryObj = {
  parameters: seed([[["nodes"], [node({ nodeId: "anakin" })]], [["settings", "anakin"], report({ locked: ["claude", "remoteTools"], sources: { projectRoots: "file", readOnlyRoots: "file", onDeviceTools: "default", remoteTools: "env", modelControl: "file", claude: "env", gameProcesses: "default", idleUnloadMinutes: "default", limitedProcesses: "default", limitedMaxGb: "default", skillFolders: "default" } })]]),
  render: () => {
    return <DevicesView />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/fixed by CLAUDE_ENABLED/)).toBeVisible();
    await expect(canvas.getByText(/fixed by ALLOW_REMOTE_TOOLS/)).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Claude" })).toBeDisabled();
    await expect(within(canvas.getByRole("radiogroup", { name: "Tools that reach out" })).getByRole("radio", { name: "Read-only" })).toBeDisabled();
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
