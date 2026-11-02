import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// What the desktop app remembers: which gateway to show, the key to sign in with (stored encrypted by the operating system's credential
// store, never in plain text), what to call this machine, and whether to start at login. Plain functions so they can be tested without
// Electron; the encryption is handed in.

export interface DesktopConfig {
  gatewayUrl: string;
  key: string;
  nodeId: string;
  openAtLogin: boolean;
}

export interface Crypter {
  encrypt: (text: string) => Promise<string>;
  decrypt: (encrypted: string) => Promise<string>;
  // False on a system with no credential store to keep the key in; the key is then not remembered.
  available: () => Promise<boolean>;
}

interface Stored {
  gatewayUrl: string;
  keyEncrypted?: string;
  nodeId: string;
  openAtLogin: boolean;
}

// A gateway address as the app keeps it: http or https, no path, no trailing slash. Throws a sentence for the person if it cannot be one.
export const normalizeGatewayUrl = (raw: string): string => {
  const text = raw.trim();
  if (text === "") {
    throw new Error("Enter the address of your gateway, such as http://truenas-scale:8787");
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error(`"${text}" is not an address`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The gateway address must start with http:// or https://");
  }
  return url.origin;
};

// The name this machine goes by: the host name, tidied to letters, digits, dots, dashes and underscores.
export const defaultNodeId = (hostname: string = os.hostname()): string => {
  const name = hostname.replace(/\.local$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name === "" ? "this-device" : name.slice(0, 64);
};

export const createConfigStore = (file: string, crypter: Crypter) => {
  const read = async (): Promise<DesktopConfig | undefined> => {
    let stored: Stored;
    try {
      stored = JSON.parse(await fs.readFile(file, "utf8")) as Stored;
    } catch {
      return undefined;
    }
    if (typeof stored.gatewayUrl !== "string" || stored.gatewayUrl === "") {
      return undefined;
    }
    let key = "";
    if (stored.keyEncrypted && await crypter.available()) {
      try {
        key = await crypter.decrypt(stored.keyEncrypted);
      } catch {
        key = "";
      }
    }
    return { gatewayUrl: stored.gatewayUrl, key, nodeId: stored.nodeId || defaultNodeId(), openAtLogin: stored.openAtLogin };
  };

  return {
    read,
    async write(config: DesktopConfig): Promise<void> {
      const stored: Stored = {
        gatewayUrl: normalizeGatewayUrl(config.gatewayUrl),
        ...(config.key && await crypter.available() ? { keyEncrypted: await crypter.encrypt(config.key) } : {}),
        nodeId: config.nodeId,
        openAtLogin: config.openAtLogin,
      };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    },
  };
};

export type ConfigStore = ReturnType<typeof createConfigStore>;
