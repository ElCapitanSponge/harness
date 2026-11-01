import type { NodeRecord } from "@harness/core";

const table = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((h, i) => {
    return Math.max(h.length, ...rows.map((r) => {
      return (r[i] ?? "").length;
    }));
  });
  const line = (cells: string[]) => {
    return cells.map((c, i) => {
      return c.padEnd(widths[i] ?? 0);
    }).join("  ").trimEnd();
  };
  return [line(headers), ...rows.map(line)].join("\n");
};

export const formatNodes = (nodes: NodeRecord[], now = Date.now()): string => {
  if (nodes.length === 0) {
    return "No nodes are reporting to the gateway.";
  }
  return table(
    ["NODE", "KIND", "STATUS", "LOADED", "ROOTS", "LAST SEEN"],
    nodes.map((n) => {
      return [
        n.nodeId,
        n.kind,
        n.busy ? `busy (${n.busyReason ?? "unknown"})` : "idle",
        String(n.models.filter((m) => {
          return m.loaded;
        }).length),
        n.roots?.length ? n.roots.join(",") : "-",
        `${Math.max(0, Math.round((now - n.lastSeen) / 1000))}s ago`,
      ];
    }),
  );
};

export const formatModels = (nodes: NodeRecord[]): string => {
  const rows = nodes.flatMap((n) => {
    return n.models.map((m) => {
      return [m.id, n.nodeId, m.loaded ? "loaded" : "-", m.contextLength ? String(m.contextLength) : "?"];
    });
  },
  );
  if (rows.length === 0) {
    return "No models reported.";
  }
  rows.sort((a, b) => {
    return (a[2] === b[2] ? (a[0] ?? "").localeCompare(b[0] ?? "") : a[2] === "loaded" ? -1 : 1);
  });
  return table(["MODEL", "NODE", "STATE", "CONTEXT"], rows);
};
