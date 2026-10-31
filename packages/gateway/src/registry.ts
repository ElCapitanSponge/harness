import { NODE_TTL_MS, type Heartbeat, type NodeRecord } from "@harness/core";

export class Registry {
  private nodes = new Map<string, NodeRecord>();

  upsert(hb: Heartbeat): void {
    this.nodes.set(hb.nodeId, { ...hb, lastSeen: Date.now() });
  }

  live(): NodeRecord[] {
    const cutoff = Date.now() - NODE_TTL_MS;
    return [...this.nodes.values()].filter((n) => n.lastSeen >= cutoff);
  }
}
