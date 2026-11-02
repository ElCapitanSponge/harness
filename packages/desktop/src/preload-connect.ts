import { contextBridge, ipcRenderer } from "electron";

// For the app's own "connect to your gateway" page only: read what is remembered, and save a new gateway, key and name for this machine.
contextBridge.exposeInMainWorld("toriiConnect", {
  initial: (): Promise<{ gatewayUrl: string; nodeId: string }> => {
    return ipcRenderer.invoke("connect:initial") as Promise<{ gatewayUrl: string; nodeId: string }>;
  },
  save: (input: { gatewayUrl: string; key: string; nodeId: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
    return ipcRenderer.invoke("connect:save", input) as Promise<{ ok: true } | { ok: false; error: string }>;
  },
});
