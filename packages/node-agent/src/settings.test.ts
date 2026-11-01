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
    expect(report.settings).toMatchObject({ projectRoots: {}, allowedTools: ["read_file", "list_dir", "grep"], modelControl: false, claude: false });
    expect(Object.values(report.sources)).toEqual(["default", "default", "default", "default", "default"]);
    expect(report.locked).toEqual([]);
  });

  it("apply live, are saved, and are read back at the next start", async () => {
    const { settings, audit, changes } = await make();
    const result = await settings.apply({ allowedTools: ["read_file", "write_file"], modelControl: true, projectRoots: { proj: dir } });
    expect(result.ok).toBe(true);
    expect(settings.current()).toMatchObject({ allowedTools: ["read_file", "write_file"], modelControl: true, projectRoots: { proj: dir } });
    expect(changes).toHaveLength(1);
    expect(audit).toMatchObject([{ tool: "settings", outcome: "ok", summary: "changed allowedTools, modelControl, projectRoots" }]);

    const restarted = (await make()).settings.report();
    expect(restarted.settings.modelControl).toBe(true);
    expect(restarted.sources.modelControl).toBe("file");
    expect(restarted.sources.claude).toBe("default");
  });

  it("let an environment variable win and lock the setting", async () => {
    const { settings, audit } = await make({ env: { ALLOW_MODEL_CONTROL: "0", ALLOWED_TOOLS: "grep" } });
    expect(settings.current()).toMatchObject({ modelControl: false, allowedTools: ["grep"] });
    expect(settings.report().locked).toEqual(["allowedTools", "modelControl"]);
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
    expect(await settings.apply({ allowedTools: ["read_file", "format_disk"] })).toEqual({ ok: false, error: "unknown tool: format_disk" });
    expect(await settings.apply({ projectRoots: { gone: path.join(dir, "missing") } })).toMatchObject({ ok: false, error: expect.stringContaining("\"gone\" is not a folder") as string });
    expect(await settings.apply([])).toEqual({ ok: false, error: "settings must be an object" });

    // One good part and one bad part: neither is applied.
    expect(await settings.apply({ claude: true, allowedTools: ["bad"] })).toMatchObject({ ok: false });
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
