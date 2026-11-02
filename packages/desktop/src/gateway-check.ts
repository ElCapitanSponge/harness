import type { DesktopConfig } from "./config.js";

// Asking the gateway about itself: whether this address and key work (before they are saved), and whether this device is listed.

export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const headers = (key: string): Record<string, string> => {
  return key ? { authorization: `Bearer ${key}` } : {};
};

// Says in a sentence for the person what is wrong with a gateway address and key, or nothing if they work.
export const checkGateway = async (gatewayUrl: string, key: string, fetchImpl: Fetch): Promise<string | undefined> => {
  try {
    const res = await fetchImpl(`${gatewayUrl}/nodes`, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (res.status === 401) {
      return "The gateway rejected that key.";
    }
    if (!res.ok) {
      return `The gateway answered with an error (${String(res.status)}). Is that the right address?`;
    }
    return undefined;
  } catch {
    return `Could not reach ${gatewayUrl}. Check the address, and that this machine can reach it (for example over Tailscale).`;
  }
};

// Whether the gateway lists this machine's device.
export const deviceListed = async (config: DesktopConfig, fetchImpl: Fetch): Promise<boolean> => {
  const res = await fetchImpl(`${config.gatewayUrl}/nodes`, { headers: headers(config.key), signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    return false;
  }
  const nodes = await res.json();
  return Array.isArray(nodes) && nodes.some((n) => {
    return (n as { nodeId?: unknown }).nodeId === config.nodeId;
  });
};
