import { spawn } from "node:child_process";
import path from "node:path";
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, safeStorage, shell } from "electron";
import { createAgentHost, type AgentState, type ChildLike } from "./agent-host.js";
import { setLinuxAutostart } from "./autostart.js";
import { createConfigStore, defaultNodeId, normalizeGatewayUrl, type DesktopConfig } from "./config.js";
import { readPicked } from "./files.js";
import { checkGateway, deviceListed } from "./gateway-check.js";
import { stateLabel, trayMenu } from "./tray.js";

// The desktop app (docs/adr/0012-...): this machine's front door to a Torii gateway. It shows the gateway's own interface in a window,
// runs this machine's agent for it, and offers the operating system's folder picker and notifications.

const hidden = process.argv.includes("--hidden");
const dataDir = app.getPath("userData");
const store = createConfigStore(path.join(dataDir, "desktop.json"), {
  encrypt: async (text) => {
    return (await safeStorage.encryptStringAsync(text)).toString("base64");
  },
  decrypt: async (encrypted) => {
    return (await safeStorage.decryptStringAsync(Buffer.from(encrypted, "base64"))).result;
  },
  available: () => {
    return safeStorage.isAsyncEncryptionAvailable();
  },
});

let config: DesktopConfig | undefined;
let window: BrowserWindow | undefined;
// The page that asks for a gateway is a window of its own with its own, narrower preload, so the gateway's page can never change the gateway.
let connectWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

// The bundled agent sits beside this file; in an installed app it is unpacked from the archive so a separate process can run it.
const agentFile = path.join(__dirname, "agent.mjs").replace("app.asar", "app.asar.unpacked");

const agent = createAgentHost({
  dataDir,
  spawn: (env): ChildLike => {
    const child = spawn(process.execPath, [agentFile], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return {
      pid: child.pid,
      onExit: (listener) => {
        child.on("exit", listener);
        child.on("error", () => {
          listener(null);
        });
      },
      onOutput: (listener) => {
        child.stdout.on("data", (d: Buffer) => {
          listener(d.toString("utf8"));
        });
        child.stderr.on("data", (d: Buffer) => {
          listener(d.toString("utf8"));
        });
      },
      kill: () => {
        child.kill();
      },
    };
  },
  connected: (c) => {
    return deviceListed(c, fetch);
  },
  onState: () => {
    refreshTray();
  },
  log: (text) => {
    process.stdout.write(`[agent] ${text}`);
  },
});

const refreshTray = (): void => {
  if (!tray) {
    return;
  }
  const state: AgentState = agent.state();
  tray.setToolTip(`Torii: ${stateLabel(state)}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state, config?.gatewayUrl, config?.openAtLogin ?? false, {
    open: showWindow,
    openInBrowser: () => {
      if (config) {
        void shell.openExternal(config.gatewayUrl);
      }
    },
    changeGateway: showConnect,
    startAgent: startAgent,
    stopAgent: () => {
      agent.stop();
    },
    toggleLogin: (enabled) => {
      void setLogin(enabled);
    },
    quit: () => {
      quitting = true;
      app.quit();
    },
  })));
};

const startAgent = (): void => {
  if (config) {
    agent.start(config);
  }
};

const setLogin = async (enabled: boolean): Promise<void> => {
  if (!config) {
    return;
  }
  config = { ...config, openAtLogin: enabled };
  await store.write(config);
  if (process.platform === "linux") {
    await setLinuxAutostart(enabled, process.env.APPIMAGE ?? process.execPath);
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  }
  refreshTray();
};

const createWindow = (): BrowserWindow => {
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    show: !hidden,
    title: "Torii",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The window shows the gateway the person chose and nothing else: any other address opens in their own browser.
  created.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  created.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("file:") || (config !== undefined && new URL(url).origin === new URL(config.gatewayUrl).origin);
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  // Closing the window leaves the app and its agent running in the tray.
  created.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      created.hide();
    }
  });
  return created;
};

const showWindow = (): void => {
  if (!window || window.isDestroyed()) {
    window = createWindow();
    void load();
    return;
  }
  window.show();
  window.focus();
};

// The gateway's interface, if one is chosen; if it cannot be loaded, the page that asks for a gateway.
const load = async (): Promise<void> => {
  if (!window || !config) {
    return;
  }
  await window.loadURL(config.gatewayUrl).catch(() => {
    showConnect();
  });
};

// The page that asks for the gateway, key and name of this machine.
const showConnect = (): void => {
  if (connectWindow && !connectWindow.isDestroyed()) {
    connectWindow.show();
    connectWindow.focus();
    return;
  }
  connectWindow = new BrowserWindow({
    width: 480,
    height: 640,
    title: "Connect to your gateway",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload-connect.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  connectWindow.setMenuBarVisibility(false);
  void connectWindow.loadFile(path.join(__dirname, "connect.html"));
};

ipcMain.on("torii:boot", (event) => {
  event.returnValue = { nodeId: config?.nodeId ?? defaultNodeId(), platform: process.platform, version: app.getVersion(), key: config?.key ?? "" };
});
ipcMain.handle("torii:pick-folder", async () => {
  const options = { title: "Choose a folder for coding sessions", properties: ["openDirectory" as const, "createDirectory" as const] };
  const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
});
// Files chosen with the system picker, read here as text for the page to add to a message.
ipcMain.handle("torii:pick-files", async () => {
  const options = { title: "Add files to this message", properties: ["openFile" as const, "multiSelections" as const] };
  const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : await Promise.all(result.filePaths.map(readPicked));
});
ipcMain.handle("torii:agent-state", () => {
  return agent.state();
});
ipcMain.handle("torii:agent-start", () => {
  startAgent();
});
ipcMain.handle("torii:agent-stop", () => {
  agent.stop();
});
ipcMain.handle("connect:initial", () => {
  return { gatewayUrl: config?.gatewayUrl ?? "", nodeId: config?.nodeId ?? defaultNodeId() };
});
ipcMain.handle("connect:save", async (_event, input: { gatewayUrl: string; key: string; nodeId: string }) => {
  try {
    const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl);
    const nodeId = defaultNodeId(input.nodeId);
    const problem = await checkGateway(gatewayUrl, input.key, fetch);
    if (problem) {
      return { ok: false as const, error: problem };
    }
    config = { gatewayUrl, key: input.key, nodeId, openAtLogin: config?.openAtLogin ?? false };
    await store.write(config);
    agent.start(config);
    if (connectWindow && !connectWindow.isDestroyed()) {
      connectWindow.destroy();
    }
    showWindow();
    await load();
    refreshTray();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
    agent.stop();
  });
  // The window closing does not end the app; only Quit does.
  app.on("window-all-closed", () => {
    return undefined;
  });
  app.on("activate", showWindow);

  void app.whenReady().then(async () => {
    config = await store.read();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 22, height: 22 }));
    tray.on("click", showWindow);
    window = createWindow();
    if (config) {
      await load();
      startAgent();
    } else {
      // First run: nothing to show until a gateway is chosen.
      showConnect();
    }
    refreshTray();
    setInterval(() => {
      void agent.refresh().then(refreshTray);
    }, 10_000);
  });
}
