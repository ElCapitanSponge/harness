import type { NodeRecord } from "@harness/core";

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

export function formatNodes(nodes: NodeRecord[], now = Date.now()): string {
  if (nodes.length === 0) return "No nodes are reporting to the gateway.";
  return table(
    ["NODE", "KIND", "STATUS", "LOADED", "LAST SEEN"],
    nodes.map((n) => [
      n.nodeId,
      n.kind,
      n.busy ? `busy (${n.busyReason ?? "unknown"})` : "idle",
      String(n.models.filter((m) => m.loaded).length),
      `${Math.max(0, Math.round((now - n.lastSeen) / 1000))}s ago`,
    ]),
  );
}

export function formatModels(nodes: NodeRecord[]): string {
  const rows = nodes.flatMap((n) =>
    n.models.map((m) => [m.id, n.nodeId, m.loaded ? "loaded" : "-", m.contextLength ? String(m.contextLength) : "?"]),
  );
  if (rows.length === 0) return "No models reported.";
  rows.sort((a, b) => (a[2] === b[2] ? a[0]!.localeCompare(b[0]!) : a[2] === "loaded" ? -1 : 1));
  return table(["MODEL", "NODE", "STATE", "CONTEXT"], rows);
}
