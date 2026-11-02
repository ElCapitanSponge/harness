import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SettingsReport, TunnelMessage } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "./audit.js";
import { createSettings } from "./settings.js";
import { createSettingsServer } from "./settingsserver.js";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-settings-"));
  file = path.join(dir, "settings.json");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const make = (over: { env?: NodeJS.ProcessEnv; remoteConfig?: boolean } = {}) => {
  const audit: AuditEntry[] = [];
  const changes: unknown[] = [];
  return createSettings({
    file,
    env: over.env ?? {},
    remoteConfig: over.remoteConfig ?? true,
    audit: (e) => {
      audit.push(e);
    },
    onChange: (s) => {
      changes.push(s);
    },
    warn: () => {
      return undefined;
    },
  }).then((settings) => {
    return { settings, audit, changes };
  });
};

describe("device settings", () => {
  it("start from safe defaults and say so", async () => {
    const { settings } = await make();
    const report = settings.report();
    // Reading on the device is on; reaching out, and changing anything, is off until chosen.
    expect(report.settings).toMatchObject({ projectRoots: {}, readOnlyRoots: [], onDeviceTools: "read", remoteTools: "off", modelControl: false, claude: false, idleUnloadMinutes: 20 });
    expect(Object.values(report.sources).every((s) => {
      return s === "default";
    })).toBe(true);
    expect(report.locked).toEqual([]);
    expect(settings.tools()).toEqual(expect.arrayContaining(["read_file", "list_dir", "grep", "git_read", "jq", "fzf_filter"]));
    expect(settings.tools()).not.toEqual(expect.arrayContaining(["write_file"]));
    expect(settings.tools()).not.toEqual(expect.arrayContaining(["web_fetch"]));
  });

  it("apply live, are saved, and are read back at the next start", async () => {
    const { settings, audit, changes } = await make();
    const result = await settings.apply({ onDeviceTools: "change", modelControl: true, projectRoots: { proj: dir } });
    expect(result.ok).toBe(true);
    expect(settings.current()).toMatchObject({ onDeviceTools: "change", modelControl: true, projectRoots: { proj: dir } });
    expect(changes).toHaveLength(1);
    expect(audit).toMatchObject([{ tool: "settings", outcome: "ok", summary: "changed onDeviceTools, modelControl, projectRoots" }]);

    const restarted = (await make()).settings.report();
    expect(restarted.settings.modelControl).toBe(true);
    expect(restarted.sources.modelControl).toBe("file");
    expect(restarted.sources.claude).toBe("default");
  });

  it("let an environment variable win and lock the setting", async () => {
    const { settings, audit } = await make({ env: { ALLOW_MODEL_CONTROL: "0", ALLOW_REMOTE_TOOLS: "read" } });
    expect(settings.current()).toMatchObject({ modelControl: false, remoteTools: "read" });
    expect(settings.report().locked).toEqual(["remoteTools", "modelControl"]);
    expect(settings.report().sources.modelControl).toBe("env");

    const result = await settings.apply({ modelControl: true });
    expect(result).toEqual({ ok: false, error: "modelControl is fixed by the ALLOW_MODEL_CONTROL environment variable on this device" });
    expect(settings.current().modelControl).toBe(false);
    expect(audit[0]).toMatchObject({ outcome: "refused" });
  });

  it("refuse every change unless the device was started to accept them", async () => {
    const { settings, audit } = await make({ remoteConfig: false });
    expect(settings.report().remoteConfig).toBe(false);
    const result = await settings.apply({ claude: true });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("REMOTE_CONFIG=1") as string });
    expect(settings.current().claude).toBe(false);
    await expect(fs.access(file)).rejects.toThrow();
    expect(audit[0]).toMatchObject({ outcome: "refused" });
  });

  it("reject invalid values with a reason, and change nothing when any part is invalid", async () => {
    const { settings } = await make();
    expect(await settings.apply({ nope: 1 })).toEqual({ ok: false, error: "unknown setting \"nope\"" });
    expect(await settings.apply({ modelControl: "yes" })).toMatchObject({ ok: false, error: expect.stringContaining("modelControl is not valid") as string });
    expect(await settings.apply({ onDeviceTools: "everything" })).toMatchObject({ ok: false, error: expect.stringContaining("onDeviceTools is not valid") as string });
    expect(await settings.apply({ projectRoots: { gone: path.join(dir, "missing") } })).toMatchObject({ ok: false, error: expect.stringContaining("\"gone\" is not a folder") as string });
    expect(await settings.apply([])).toEqual({ ok: false, error: "settings must be an object" });

    // One good part and one bad part: neither is applied.
    expect(await settings.apply({ claude: true, remoteTools: "sometimes" })).toMatchObject({ ok: false });
    expect(settings.current().claude).toBe(false);
  });

  it("ignore a damaged saved file rather than refusing to start", async () => {
    await fs.writeFile(file, "{not json");
    expect((await make()).settings.current().claude).toBe(false);
    await fs.writeFile(file, JSON.stringify({ claude: "maybe", modelControl: true }));
    const { settings } = await make();
    expect(settings.current()).toMatchObject({ claude: false, modelControl: true });
  });
});

describe("the two groups of tools", () => {
  it("give a group its reading tools at read-only and its changing tools too at can-change", async () => {
    const { settings } = await make();
    await settings.apply({ onDeviceTools: "change", remoteTools: "read" });
    const names = settings.tools();
    expect(names).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "run_command", "git_read", "git_write", "web_fetch", "gh_read"]));
    expect(names).not.toContain("gh_write");

    await settings.apply({ onDeviceTools: "off", remoteTools: "change" });
    expect(settings.tools().sort()).toEqual(["gh_read", "gh_write", "web_fetch"]);

    await settings.apply({ remoteTools: "off" });
    expect(settings.tools()).toEqual([]);
  });

  it("lists every tool with its group, level and whether it asks first, for the page", async () => {
    const { settings } = await make();
    const byName = Object.fromEntries((settings.report().tools ?? []).map((t) => {
      return [t.name, t];
    }));
    expect(byName.read_file).toMatchObject({ group: "device", level: "read", asksFirst: false });
    expect(byName.git_write).toMatchObject({ group: "device", level: "change", asksFirst: true });
    expect(byName.web_fetch).toMatchObject({ group: "remote", level: "read", asksFirst: true });
    expect(byName.gh_write).toMatchObject({ group: "remote", level: "change", asksFirst: true });
  });

  it("turn the old list from an earlier version into the levels it amounts to, in the file and in the environment", async () => {
    await fs.writeFile(file, JSON.stringify({ allowedTools: ["read_file", "write_file", "web_fetch"] }));
    const saved = await make();
    expect(saved.settings.current()).toMatchObject({ onDeviceTools: "change", remoteTools: "read" });

    const fromEnv = await make({ env: { ALLOWED_TOOLS: "read_file,list_dir,grep" } });
    expect(fromEnv.settings.current()).toMatchObject({ onDeviceTools: "read", remoteTools: "off" });
    // The list decides exactly which tools there are, and both groups are locked by it.
    expect(fromEnv.settings.tools()).toEqual(["read_file", "list_dir", "grep"]);
    expect(fromEnv.settings.report().locked).toEqual(expect.arrayContaining(["onDeviceTools", "remoteTools"]));
    expect(await fromEnv.settings.apply({ onDeviceTools: "change" })).toEqual({ ok: false, error: "onDeviceTools is fixed by the ALLOWED_TOOLS environment variable on this device" });
  });

  it("still take a list of tool names in a change, as the old page and scripts send it", async () => {
    const { settings } = await make();
    await settings.apply({ allowedTools: ["read_file", "run_command"] });
    expect(settings.current()).toMatchObject({ onDeviceTools: "change", remoteTools: "off" });
  });
});

describe("folders that can only be read", () => {
  it("are saved as names, reported, and unset again", async () => {
    const { settings } = await make();
    await settings.apply({ projectRoots: { a: dir, b: dir }, readOnlyRoots: ["a"] });
    expect(settings.current().readOnlyRoots).toEqual(["a"]);
    await settings.apply({ readOnlyRoots: [] });
    expect(settings.current().readOnlyRoots).toEqual([]);
  });

  it("can be fixed by READ_ONLY_ROOTS", async () => {
    const { settings } = await make({ env: { READ_ONLY_ROOTS: "a, b" } });
    expect(settings.current().readOnlyRoots).toEqual(["a", "b"]);
    expect(await settings.apply({ readOnlyRoots: [] })).toMatchObject({ ok: false, error: expect.stringContaining("READ_ONLY_ROOTS") as string });
  });
});

describe("the idle unload setting", () => {
  it("is twenty minutes unless set, can be changed from the page, and is validated", async () => {
    const { settings } = await make();
    expect(settings.current().idleUnloadMinutes).toBe(20);
    expect((await settings.apply({ idleUnloadMinutes: 15 })).ok).toBe(true);
    expect(settings.current().idleUnloadMinutes).toBe(15);
    expect((await settings.apply({ idleUnloadMinutes: 0 })).ok).toBe(true);
    expect(await settings.apply({ idleUnloadMinutes: -1 })).toMatchObject({ ok: false });
    expect(await settings.apply({ idleUnloadMinutes: 1.5 })).toMatchObject({ ok: false });
    expect(await settings.apply({ idleUnloadMinutes: 5000 })).toMatchObject({ ok: false });
    expect(await settings.apply({ idleUnloadMinutes: "soon" })).toMatchObject({ ok: false });
  });

  it("is fixed by IDLE_UNLOAD_MINUTES when that is set", async () => {
    const { settings } = await make({ env: { IDLE_UNLOAD_MINUTES: "30" } });
    expect(settings.current().idleUnloadMinutes).toBe(30);
    expect(settings.report().locked).toContain("idleUnloadMinutes");
    expect(await settings.apply({ idleUnloadMinutes: 5 })).toEqual({ ok: false, error: "idleUnloadMinutes is fixed by the IDLE_UNLOAD_MINUTES environment variable on this device" });
    expect((await make({ env: { IDLE_UNLOAD_MINUTES: "nonsense" } })).settings.current().idleUnloadMinutes).toBe(20);
  });
});

describe("the settings server", () => {
  it("answers a read with the report and a change with the new report or the reason", async () => {
    const { settings } = await make();
    const send = vi.fn<(m: TunnelMessage) => void>();
    const server = createSettingsServer(settings);

    await server.handle({ type: "settings", id: "1", op: "get" }, send);
    const first = send.mock.calls[0]?.[0] as Extract<TunnelMessage, { type: "tool-result" }>;
    expect(first.ok).toBe(true);
    expect((JSON.parse(first.output) as SettingsReport).remoteConfig).toBe(true);

    await server.handle({ type: "settings", id: "2", op: "set", settings: { claude: true } }, send);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ id: "2", ok: true });

    await server.handle({ type: "settings", id: "3", op: "set", settings: { claude: 5 } }, send);
    expect(send.mock.calls[2]?.[0]).toMatchObject({ id: "3", ok: false });
  });
});

describe("skill folders", () => {
  it("are empty by default, can be set to folders that exist, and are refused when they are not full paths or not folders", async () => {
    const { settings } = await make();
    expect(settings.current().skillFolders).toEqual([]);
    expect(await settings.apply({ skillFolders: ["relative/skills"] })).toMatchObject({ ok: false, error: expect.stringContaining("must be a full path") as string });
    expect(await settings.apply({ skillFolders: [path.join(dir, "missing")] })).toMatchObject({ ok: false, error: expect.stringContaining("is not a folder on this device") as string });

    const skills = path.join(dir, "skills");
    await fs.mkdir(skills);
    expect(await settings.apply({ skillFolders: [skills] })).toMatchObject({ ok: true });
    expect(settings.current().skillFolders).toEqual([skills]);
  });

  it("can be fixed by SKILL_FOLDERS, which locks the setting", async () => {
    const { settings } = await make({ env: { SKILL_FOLDERS: "/a/skills, /b/skills" } });
    expect(settings.current().skillFolders).toEqual(["/a/skills", "/b/skills"]);
    expect(await settings.apply({ skillFolders: [] })).toMatchObject({ ok: false });
  });
});
