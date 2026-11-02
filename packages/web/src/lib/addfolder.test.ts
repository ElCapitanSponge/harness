import { describe, expect, it, vi } from "vitest";
import { addProjectFolder, type AddFolderDeps } from "./addfolder";
import type { NodeRecord, SettingsReport } from "./types";

const report = (projectRoots: Record<string, string>, over: Partial<SettingsReport> = {}): SettingsReport => {
  return { settings: { projectRoots }, sources: {}, locked: [], remoteConfig: true, ...over } as unknown as SettingsReport;
};
const node = (roots: string[]): NodeRecord => {
  return { nodeId: "anakin", kind: "local", busy: false, models: [], roots, lastSeen: 0 };
};

const deps = (over: Partial<AddFolderDeps> = {}) => {
  const save = vi.fn<AddFolderDeps["save"]>(over.save ?? (() => {
    return Promise.resolve({});
  }));
  const pause = vi.fn<NonNullable<AddFolderDeps["pause"]>>(() => {
    return Promise.resolve();
  });
  const all: AddFolderDeps = {
    settings: () => {
      return Promise.resolve(report({ app: "C:/work/app" }));
    },
    nodes: () => {
      return Promise.resolve([node(["app", "site"])]);
    },
    ...over,
    save,
    pause,
  };
  return { all, save, pause };
};

describe("adding a folder chosen with the system picker as a project folder", () => {
  it("adds the folder under its own name and returns once the device lists it", async () => {
    const d = deps();
    expect(await addProjectFolder("anakin", "C:\\work\\site", d.all)).toEqual({ ok: true, root: "site", added: true });
    expect(d.save).toHaveBeenCalledWith("anakin", { app: "C:/work/app", site: "C:\\work\\site" });
  });

  it("reuses a folder that is already a project, however it is written, and saves nothing", async () => {
    const d = deps();
    expect(await addProjectFolder("anakin", "c:\\Work\\App\\", d.all)).toEqual({ ok: true, root: "app", added: false });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("gives a folder whose name is taken another name", async () => {
    const d = deps({ nodes: () => {
      return Promise.resolve([node(["app", "app-2"])]);
    } });
    expect(await addProjectFolder("anakin", "D:/other/app", d.all)).toEqual({ ok: true, root: "app-2", added: true });
    expect(d.save).toHaveBeenCalledWith("anakin", { "app": "C:/work/app", "app-2": "D:/other/app" });
  });

  it("waits for the device to list the folder", async () => {
    const lists = [[node(["app"])], [node(["app"])], [node(["app", "site"])]];
    const d = deps({ nodes: () => {
      return Promise.resolve(lists.shift() ?? [node(["app", "site"])]);
    } });
    expect(await addProjectFolder("anakin", "C:/work/site", d.all)).toMatchObject({ ok: true, root: "site" });
    expect(d.pause).toHaveBeenCalledTimes(2);
  });

  it("puts the folders back and says so when the device never lists it", async () => {
    const d = deps({ nodes: () => {
      return Promise.resolve([node(["app"])]);
    }, waitMs: 2000 });
    const result = await addProjectFolder("anakin", "C:/work/site", d.all);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("did not list the folder");
    expect(d.save).toHaveBeenLastCalledWith("anakin", { app: "C:/work/app" });
  });

  it("says why when the device's folders are fixed by its environment or remote settings are off", async () => {
    for (const over of [{ locked: ["projectRoots"] }, { remoteConfig: false }]) {
      const d = deps({ settings: () => {
        return Promise.resolve(report({ app: "C:/work/app" }, over as Partial<SettingsReport>));
      } });
      const result = await addProjectFolder("anakin", "C:/work/site", d.all);
      expect(result.ok ? "" : result.error).toContain("fixed where the agent is started");
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  it("says when the device would not accept the folder, and when settings cannot be read, adding nothing", async () => {
    const refuses = deps({ save: () => {
      return Promise.reject(new Error("bad path"));
    } });
    const a = await addProjectFolder("anakin", "C:/work/site", refuses.all);
    expect(a.ok ? "" : a.error).toBe("The device would not accept the folder: bad path");
    const unreadable = deps({ settings: () => {
      return Promise.reject(new Error("offline"));
    } });
    const b = await addProjectFolder("anakin", "C:/work/site", unreadable.all);
    expect(b.ok ? "" : b.error).toContain("Could not read this device's settings: offline");
    expect(unreadable.save).not.toHaveBeenCalled();
  });
});
