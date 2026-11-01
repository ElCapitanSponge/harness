import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Catalogue, NodeRecord, SessionInfo, SettingsReport } from "./types";

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
