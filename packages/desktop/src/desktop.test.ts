import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentEnv, createAgentHost, type AgentState, type ChildLike } from "./agent-host.js";
import { linuxAutostartEntry, linuxAutostartFile, setLinuxAutostart } from "./autostart.js";
import { createConfigStore, defaultNodeId, normalizeGatewayUrl, type Crypter, type DesktopConfig } from "./config.js";
import { MAX_CONTEXT_FILE_BYTES, readPicked } from "./files.js";
import { checkGateway, deviceListed, type Fetch } from "./gateway-check.js";
import { stateLabel, trayMenu, type TrayActions } from "./tray.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const config: DesktopConfig = { gatewayUrl: "http://truenas-scale:8787", key: "secret-key", nodeId: "anakin", openAtLogin: false };

describe("the gateway address", () => {
  it("is kept as http or https with no path, and a bare host gets http", () => {
    expect(normalizeGatewayUrl("truenas-scale:8787")).toBe("http://truenas-scale:8787");
    expect(normalizeGatewayUrl(" https://torii.example.com/some/path/ ")).toBe("https://torii.example.com");
    expect(normalizeGatewayUrl("http://100.83.115.110:8787/")).toBe("http://100.83.115.110:8787");
  });

  it("says in a sentence what is wrong with one that cannot be used", () => {
    expect(() => {
      return normalizeGatewayUrl("");
    }).toThrow("Enter the address");
    expect(() => {
      return normalizeGatewayUrl("ftp://host");
    }).toThrow("http:// or https://");
    expect(() => {
      return normalizeGatewayUrl("http://");
    }).toThrow("is not an address");
  });

  it("gives a machine a tidy name from its host name", () => {
    expect(defaultNodeId("Andres-MacBook-Air.local")).toBe("Andres-MacBook-Air");
    expect(defaultNodeId("my pc!")).toBe("my-pc");
    expect(defaultNodeId("")).toBe("this-device");
  });
});

describe("what the app remembers", () => {
  const crypter = (available = true): Crypter => {
    return { encrypt: (t) => {
      return Promise.resolve(Buffer.from(`enc:${t}`).toString("base64"));
    }, decrypt: (e) => {
      return Promise.resolve(Buffer.from(e, "base64").toString().replace(/^enc:/, ""));
    }, available: () => {
      return Promise.resolve(available);
    } };
  };

  it("keeps the gateway and the name, and the key only in encrypted form", async () => {
    const file = path.join(dir, "desktop.json");
    const store = createConfigStore(file, crypter());
    await store.write(config);
    const onDisk = await fs.readFile(file, "utf8");
    expect(onDisk).not.toContain("secret-key");
    expect(onDisk).toContain("truenas-scale");
    expect(await store.read()).toEqual(config);
  });

  it("does not remember the key where there is no credential store to keep it in, so it is asked for again", async () => {
    const file = path.join(dir, "desktop.json");
    const store = createConfigStore(file, crypter(false));
    await store.write(config);
    expect(await fs.readFile(file, "utf8")).not.toContain("keyEncrypted");
    expect(await store.read()).toEqual({ ...config, key: "" });
  });

  it("has nothing before the first run, and nothing from a file that is not its own", async () => {
    const file = path.join(dir, "desktop.json");
    const store = createConfigStore(file, crypter());
    expect(await store.read()).toBeUndefined();
    await fs.writeFile(file, "not json");
    expect(await store.read()).toBeUndefined();
  });
});

describe("checking a gateway before it is saved", () => {
  const answer = (status: number, body: unknown = []): Fetch => {
    return () => {
      return Promise.resolve({ ok: status < 400, status, json: () => {
        return Promise.resolve(body);
      } });
    };
  };

  it("says nothing when it works, and says what is wrong when it does not", async () => {
    expect(await checkGateway("http://g", "k", answer(200))).toBeUndefined();
    expect(await checkGateway("http://g", "k", answer(401))).toBe("The gateway rejected that key.");
    expect(await checkGateway("http://g", "k", answer(502))).toContain("error (502)");
    expect(await checkGateway("http://g", "k", () => {
      return Promise.reject(new Error("ECONNREFUSED"));
    })).toContain("Could not reach http://g");
  });

  it("sends the key, and finds this device among the gateway's", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    const fetchImpl: Fetch = (_url, init) => {
      seen.push(init?.headers);
      return Promise.resolve({ ok: true, status: 200, json: () => {
        return Promise.resolve([{ nodeId: "bastila" }, { nodeId: "anakin" }]);
      } });
    };
    expect(await deviceListed(config, fetchImpl)).toBe(true);
    expect(await deviceListed({ ...config, nodeId: "other" }, fetchImpl)).toBe(false);
    expect(seen[0]).toEqual({ authorization: "Bearer secret-key" });
    expect(await deviceListed(config, answer(500))).toBe(false);
  });
});

describe("the environment the agent is started with", () => {
  it("has the gateway, key and name, remote configuration on, and its files in the app's folder, and nothing of the app's own", () => {
    const env = agentEnv(config, "/data", { PATH: "/usr/bin", HOME: "/home/a", ELECTRON_RUN_AS_NODE: undefined, SECRET_TOKEN: "no", NODE_OPTIONS: "--inspect" });
    expect(env).toMatchObject({ GATEWAY_URL: config.gatewayUrl, HARNESS_API_KEY: "secret-key", NODE_ID: "anakin", REMOTE_CONFIG: "1", SETTINGS_FILE: "/data/agent-settings.json", AUDIT_LOG: "/data/audit.log", ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin", HOME: "/home/a" });
    expect(env).not.toHaveProperty("SECRET_TOKEN");
    expect(env).not.toHaveProperty("NODE_OPTIONS");
  });
});

describe("the agent's lifecycle", () => {
  const fakeChild = () => {
    const listeners: { exit: ((code: number | null) => void)[]; output: ((text: string) => void)[] } = { exit: [], output: [] };
    const child: ChildLike & { killed: boolean; crash: (code: number | null) => void; say: (text: string) => void } = {
      killed: false,
      onExit: (l) => {
        listeners.exit.push(l);
      },
      onOutput: (l) => {
        listeners.output.push(l);
      },
      kill: () => {
        child.killed = true;
      },
      crash: (code) => {
        for (const l of listeners.exit) {
          l(code);
        }
      },
      say: (text) => {
        for (const l of listeners.output) {
          l(text);
        }
      },
    };
    return child;
  };

  const setup = (over: { connected?: boolean; delays?: number[] } = {}) => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const states: AgentState[] = [];
    const envs: Record<string, string>[] = [];
    const waits: number[] = [];
    let connected = over.connected ?? false;
    const host = createAgentHost({
      dataDir: "/data",
      spawn: (env) => {
        envs.push(env);
        const c = fakeChild();
        children.push(c);
        return c;
      },
      connected: () => {
        return Promise.resolve(connected);
      },
      onState: (s) => {
        states.push(s);
      },
      restartDelaysMs: over.delays ?? [10, 20],
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      log: vi.fn(),
    });
    return { host, children, states, envs, waits, setConnected: (v: boolean) => {
      connected = v;
    } };
  };

  it("starts the agent with the app's settings, moves to connected when the gateway lists the device, and stops it", async () => {
    const t = setup({ connected: true });
    t.host.start(config);
    expect(t.host.state()).toBe("running");
    expect(t.envs[0]).toMatchObject({ GATEWAY_URL: config.gatewayUrl, NODE_ID: "anakin" });
    expect(await t.host.refresh()).toBe("connected");
    t.setConnected(false);
    expect(await t.host.refresh()).toBe("running");
    t.host.stop();
    expect(t.children[0]?.killed).toBe(true);
    expect(t.host.state()).toBe("stopped");
    expect(await t.host.refresh()).toBe("stopped");
  });

  it("restarts the agent after a crash, with growing delays, and gives up after the last", async () => {
    const t = setup({ delays: [10, 20] });
    t.host.start(config);
    t.children[0]?.crash(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.children).toHaveLength(2);
    t.children[1]?.crash(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.children).toHaveLength(3);
    t.children[2]?.crash(1);
    await Promise.resolve();
    expect(t.children).toHaveLength(3);
    expect(t.host.state()).toBe("failed");
    expect(t.waits).toEqual([10, 20]);
  });

  it("does not restart an agent that was stopped on purpose, and a restart on purpose starts one process, not two", () => {
    const t = setup();
    t.host.start(config);
    t.host.stop();
    t.children[0]?.crash(0);
    expect(t.children).toHaveLength(1);
    t.host.start(config);
    t.host.start(config);
    expect(t.children).toHaveLength(3);
    expect(t.children[1]?.killed).toBe(true);
    expect(t.children[2]?.killed).toBe(false);
  });
});

describe("the tray menu", () => {
  const actions = (): TrayActions => {
    return { open: vi.fn(), openInBrowser: vi.fn(), changeGateway: vi.fn(), startAgent: vi.fn(), stopAgent: vi.fn(), toggleLogin: vi.fn(), quit: vi.fn() };
  };

  it("says what the agent is doing, in words", () => {
    expect(stateLabel("connected")).toBe("Connected to the gateway");
    expect(stateLabel("failed")).toContain("repeated failures");
  });

  it("offers to stop a running agent and to start a stopped one, and has the login switch and quit", () => {
    const a = actions();
    const running = trayMenu("connected", "http://g", false, a);
    expect(running.map((m) => {
      return m.label;
    })).toEqual(["Connected to the gateway", "http://g", undefined, "Open Torii", "Open in the browser", undefined, "Stop the agent on this device", "Change gateway...", "Start at login", undefined, "Quit Torii"]);
    running.find((m) => {
      return m.label?.startsWith("Stop");
    })?.click?.();
    expect(a.stopAgent).toHaveBeenCalled();
    running.find((m) => {
      return m.label === "Start at login";
    })?.click?.();
    expect(a.toggleLogin).toHaveBeenCalledWith(true);

    const stopped = trayMenu("stopped", "http://g", true, a);
    stopped.find((m) => {
      return m.label?.startsWith("Start the agent");
    })?.click?.();
    expect(a.startAgent).toHaveBeenCalled();
    expect(stopped.find((m) => {
      return m.label === "Start at login";
    })?.checked).toBe(true);
  });

  it("has nothing to start before a gateway is chosen", () => {
    const menu = trayMenu("stopped", undefined, false, actions());
    expect(menu.find((m) => {
      return m.label?.startsWith("Start the agent");
    })?.enabled).toBe(false);
    expect(menu.find((m) => {
      return m.label === "Open in the browser";
    })?.enabled).toBe(false);
  });
});

describe("starting at login on Linux", () => {
  it("writes and removes an autostart entry in the user's config folder, for Ubuntu, Arch and any desktop that follows the standard", async () => {
    const file = path.join(dir, "autostart", "torii.desktop");
    await setLinuxAutostart(true, "/home/a/Torii.AppImage", file);
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("[Desktop Entry]");
    expect(text).toContain("Exec=\"/home/a/Torii.AppImage\" --hidden");
    await setLinuxAutostart(false, "/home/a/Torii.AppImage", file);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("finds the file under XDG_CONFIG_HOME when it is set, and quotes a path with spaces", () => {
    expect(linuxAutostartFile("/home/a", { XDG_CONFIG_HOME: "/custom" })).toBe(path.join("/custom", "autostart", "torii.desktop"));
    expect(linuxAutostartFile("/home/a", {})).toBe(path.join("/home/a", ".config", "autostart", "torii.desktop"));
    expect(linuxAutostartEntry("/opt/My Apps/torii")).toContain("Exec=\"/opt/My Apps/torii\" --hidden");
  });
});

describe("files chosen to add to a message", () => {
  it("reads a text file, and says why a folder, a big file or a binary file was not read", async () => {
    const text = path.join(dir, "notes.md");
    await fs.writeFile(text, "# Notes\n");
    expect(await readPicked(text)).toEqual({ path: text, name: "notes.md", content: "# Notes\n" });

    expect(await readPicked(dir)).toMatchObject({ problem: "That is not a file." });
    const big = path.join(dir, "big.txt");
    await fs.writeFile(big, "x".repeat(MAX_CONTEXT_FILE_BYTES + 1));
    expect(await readPicked(big)).toMatchObject({ problem: expect.stringContaining("larger than 200 KB") as string });
    const bin = path.join(dir, "a.bin");
    await fs.writeFile(bin, Buffer.from([1, 0, 2]));
    expect(await readPicked(bin)).toMatchObject({ problem: expect.stringContaining("binary") as string });
    expect(await readPicked(path.join(dir, "missing.txt"))).toMatchObject({ problem: expect.stringContaining("Could not read missing.txt") as string });
  });
});
