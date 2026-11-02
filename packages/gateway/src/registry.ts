import { NODE_TTL_MS, type Heartbeat, type NodeRecord } from "@harness/core";

export class Registry {
  private nodes = new Map<string, NodeRecord>();

  upsert(hb: Heartbeat, address?: string): void {
    this.nodes.set(hb.nodeId, { ...hb, lastSeen: Date.now(), ...(address ? { address } : {}) });
  }

  // Records a load or unload the gateway just did, so the next request does not wait for the device's next heartbeat to see it.
  setLoaded(nodeId: string, modelId: string, loaded: boolean): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }
    this.nodes.set(nodeId, {
      ...node,
      models: node.models.map((m) => {
        return m.id === modelId ? { ...m, loaded } : m;
      }),
    });
  }

  remove(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  live(): NodeRecord[] {
    const cutoff = Date.now() - NODE_TTL_MS;
    return [...this.nodes.values()].filter((n) => {
      return n.lastSeen >= cutoff;
    });
  }
}
