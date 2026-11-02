import { contextBridge, ipcRenderer } from "electron";

// What the page may ask of the app, and nothing else. The page is the gateway's own interface; it learns that it is running in the
// desktop app, which device this is, and can start and stop this machine's agent and open the operating system's folder picker.
// The gateway key reaches the page only as the sign-in the page would otherwise ask you to type.

interface Boot {
  nodeId: string;
  platform: string;
  version: string;
  key: string;
}

const boot = ipcRenderer.sendSync("torii:boot") as Boot;

// Signed in already, as if the key had been typed (the page keeps it for the tab, as in a browser).
if (boot.key) {
  try {
    sessionStorage.setItem("harness-key", boot.key);
  } catch {
    // Storage can be blocked; the page then asks for the key.
  }
}

contextBridge.exposeInMainWorld("torii", {
  desktop: true,
  nodeId: boot.nodeId,
  platform: boot.platform,
  version: boot.version,
  pickFolder: (): Promise<string | undefined> => {
    return ipcRenderer.invoke("torii:pick-folder") as Promise<string | undefined>;
  },
  pickFiles: (): Promise<{ path: string; name: string; content?: string; problem?: string }[]> => {
    return ipcRenderer.invoke("torii:pick-files") as Promise<{ path: string; name: string; content?: string; problem?: string }[]>;
  },
  setNeedsYou: (count: number): Promise<void> => {
    return ipcRenderer.invoke("torii:needs-you", count) as Promise<void>;
  },
  focus: (): Promise<void> => {
    return ipcRenderer.invoke("torii:focus") as Promise<void>;
  },
  agent: {
    state: (): Promise<string> => {
      return ipcRenderer.invoke("torii:agent-state") as Promise<string>;
    },
    start: (): Promise<void> => {
      return ipcRenderer.invoke("torii:agent-start") as Promise<void>;
    },
    stop: (): Promise<void> => {
      return ipcRenderer.invoke("torii:agent-stop") as Promise<void>;
    },
  },
});
