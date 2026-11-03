import type { NodeRecord, SessionInfo, SettingsReport } from "@harness/core";

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

// Saved conversations, newest activity first.
// Conversations put away in the archive are left out unless asked for, and the count of those left out is said.
export const formatSessions = (all: SessionInfo[], now = Date.now(), withArchived = false): string => {
  const sessions = all.filter((s) => {
    return withArchived || s.archived !== true;
  });
  const hidden = all.length - sessions.length;
  if (sessions.length === 0) {
    return hidden > 0
      ? `No saved conversations (${String(hidden)} archived: harness sessions --all lists them).`
      : "No saved conversations.";
  }
  const out = table(
    ["ID", "KIND", "TITLE", "MODEL", "WHERE", "ACTIVE"],
    sessions.map((s) => {
      const minutes = Math.max(0, Math.round((now - s.updated) / 60_000));
      return [s.id.slice(0, 8), s.kind, `${s.title || "(new)"}${s.archived === true ? " (archived)" : ""}`, s.model, s.kind === "code" ? `${s.device}:${s.root}${s.deviceConnected ? "" : " (offline)"}` : "-", minutes < 1 ? "now" : `${String(minutes)}m ago`];
    }),
  );
  return hidden > 0 ? `${out}\n${String(hidden)} archived, not shown: harness sessions --all lists them.` : out;
};

// A device's settings, where each came from, and whether it accepts changes from here.
export const formatSettings = (report: SettingsReport): string => {
  const rows = Object.entries(report.settings).map(([key, value]) => {
    const source = report.sources[key as keyof SettingsReport["sources"]];
    return [key, JSON.stringify(value), report.locked.includes(key as SettingsReport["locked"][number]) ? "fixed by environment" : source];
  });
  return `${table(["SETTING", "VALUE", "SOURCE"], rows)}
${report.remoteConfig ? "This device accepts changes from here." : "Read-only: start its agent with REMOTE_CONFIG=1 to change settings."}`;
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
