import { NODE_TTL_MS, type Heartbeat, type NodeRecord } from "@harness/core";

const withinLimit = (node: NodeRecord): NodeRecord => {
  const limit = node.limit;
  if (!limit) {
    return node;
  }
  // A model whose size is not known is allowed: there is nothing to compare.
  const tooBig = node.models.filter((m) => {
    return m.sizeBytes !== undefined && m.sizeBytes > limit.maxBytes;
  });
  if (tooBig.length === 0) {
    return node;
  }
  return {
    ...node,
    models: node.models.filter((m) => {
      return !tooBig.includes(m);
    }),
    limitedOut: tooBig.map((m) => {
      return { id: m.id, sizeBytes: m.sizeBytes ?? 0 };
    }),
  };
};

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

  // The devices that are connected. A device that is limited (a call is running) shows only the models small enough for it, so
  // nothing that picks a model has to know about the limit; the ones left out are listed in `limitedOut` for the page.
  live(): NodeRecord[] {
    const cutoff = Date.now() - NODE_TTL_MS;
    return [...this.nodes.values()].filter((n) => {
      return n.lastSeen >= cutoff;
    }).map(withinLimit);
  }
}
