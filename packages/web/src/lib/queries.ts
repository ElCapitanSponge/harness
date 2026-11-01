import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Catalogue, ClaudeStatus, ConversationUsage, NodeRecord, SessionInfo, SettingsReport, SkillsFolder, UsageSummary } from "./types";

// Every model on every device, and whether Claude is reachable. Refreshed so a device that connects shows up.
export const useCatalogue = () => {
  return useQuery({
    queryKey: ["catalogue"],
    queryFn: () => {
      return api<Catalogue>("/catalogue");
    },
    refetchInterval: 15_000,
  });
};

// The Claude plan's windows and whether Claude can be used now.
export const useClaudeStatus = () => {
  return useQuery({
    queryKey: ["claude", "usage"],
    queryFn: () => {
      return api<ClaudeStatus>("/claude/usage");
    },
    refetchInterval: 30_000,
  });
};

// The skills each device finds in each project folder, or in one folder.
export const useSkills = (folder?: { device: string; root: string }) => {
  const query = folder ? `?device=${encodeURIComponent(folder.device)}&root=${encodeURIComponent(folder.root)}` : "";
  return useQuery({
    queryKey: ["skills", folder?.device ?? "", folder?.root ?? ""],
    queryFn: () => {
      return api<SkillsFolder[]>(`/skills${query}`);
    },
    staleTime: 30_000,
  });
};

export const useNodes = () => {
  return useQuery({
    queryKey: ["nodes"],
    queryFn: () => {
      return api<NodeRecord[]>("/nodes");
    },
    refetchInterval: 15_000,
  });
};

export const useSessions = () => {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => {
      return api<SessionInfo[]>("/sessions");
    },
    refetchInterval: 10_000,
  });
};

// How full a conversation's context is and what each model has used in it. Refreshed when a turn ends.
export const useConversationUsage = (id: string) => {
  return useQuery({
    queryKey: ["usage", "conversation", id],
    queryFn: () => {
      return api<ConversationUsage>(`/sessions/${id}/usage`);
    },
  });
};

// Totals over the last `days` days, with days starting at this browser's midnight.
export const useUsage = (days: number) => {
  const offset = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: ["usage", "summary", days, offset],
    queryFn: () => {
      return api<UsageSummary>(`/usage?days=${String(days)}&offset=${String(offset)}`);
    },
    refetchInterval: 30_000,
  });
};

// Summarises a conversation's older turns now. The meter and the sessions are refreshed after it.
export const useCompactConversation = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => {
      return api<{ ok: true; messages: number; tokensBefore: number; tokensAfter: number }>(`/sessions/${id}/compact`, { method: "POST", body: {} });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["usage"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

export const useDeviceSettings = (nodeId: string) => {
  return useQuery({
    queryKey: ["settings", nodeId],
    queryFn: () => {
      return api<SettingsReport>(`/devices/${encodeURIComponent(nodeId)}/settings`);
    },
    retry: false,
  });
};

export const useSaveSettings = (nodeId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => {
      return api<SettingsReport>(`/devices/${encodeURIComponent(nodeId)}/settings`, { method: "PUT", body: patch });
    },
    onSuccess: (report) => {
      client.setQueryData(["settings", nodeId], report);
      void client.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
};

export const useCreateConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { model: string; device?: string; root?: string }) => {
      return api<SessionInfo>("/sessions", { method: "POST", body });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

export const useRenameConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title: string }) => {
      return api<SessionInfo>(`/sessions/${input.id}`, { method: "PATCH", body: { title: input.title } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

export const useDeleteConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return api<unknown>(`/sessions/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};
