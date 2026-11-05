import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstructionName, PermissionMode } from "@harness/core";
import { api } from "./api";
import type { Catalogue, ClaudeStatus, ConversationUsage, InstructionEntry, InstructionFile, NodeRecord, BackgroundTask, LibrarySkill, PermissionRule, SessionInfo, SettingsReport, SkillsFolder, UsageSummary } from "./types";

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

// The commands a coding session has running in the background, while the panel is open.
export const useSessionTasks = (id: string, enabled: boolean) => {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => {
      return api<BackgroundTask[]>(`/sessions/${id}/tasks`);
    },
    enabled,
    refetchInterval: 3000,
  });
};

// Forget the background tasks that have ended, on the device. Running ones are kept.
export const useClearFinishedTasks = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => {
      return api<{ cleared: number }>(`/sessions/${id}/tasks/finished`, { method: "DELETE" });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["tasks", id] });
    },
  });
};

// Take the steps that are done off the plan. The new plan arrives with the conversation's events, so nothing is refetched here.
export const useClearDonePlan = (id: string) => {
  return useMutation({
    mutationFn: () => {
      return api<{ cleared: number }>(`/sessions/${id}/plan/done`, { method: "DELETE" });
    },
  });
};

// The project's instruction files on the session's device, with whether each exists and how long it is.
export const useInstructions = (id: string) => {
  return useQuery({
    queryKey: ["instructions", id],
    queryFn: () => {
      return api<InstructionEntry[]>(`/sessions/${id}/instructions`);
    },
    retry: false,
  });
};

// One instruction file, read when it is opened. It is not refreshed behind the person's back: what they are editing stays theirs until they
// reload it or save.
export const useInstructionFile = (id: string, name: InstructionName | undefined) => {
  return useQuery({
    queryKey: ["instruction", id, name ?? ""],
    queryFn: () => {
      return api<InstructionFile>(`/sessions/${id}/instructions/${name ?? ""}`);
    },
    enabled: name !== undefined,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
};

// Save an instruction file on the device. A file that changed after it was opened is refused (409), and nothing is written.
export const useSaveInstruction = (id: string, name: InstructionName) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; version: string }) => {
      return api<{ saved: true; version: string; length: number }>(`/sessions/${id}/instructions/${name}`, { method: "PUT", body });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["instructions", id] });
      void client.invalidateQueries({ queryKey: ["instruction", id, name] });
    },
  });
};

// The skills in the gateway's own library, available in every conversation including chats.
export const useLibrary = () => {
  return useQuery({
    queryKey: ["library"],
    queryFn: () => {
      return api<LibrarySkill[]>("/library/skills");
    },
    staleTime: 30_000,
  });
};

export const useAddLibrarySkill = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { zip: string; overwrite?: boolean } | { files: { path: string; data: string }[]; overwrite?: boolean }) => {
      return api<LibrarySkill>("/library/skills", { method: "POST", body });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
    },
  });
};

export const useRemoveLibrarySkill = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      return api<unknown>(`/library/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
    },
  });
};

// The project groups collapsed in the sidebar, kept on the gateway so every client agrees.
export interface CollapsedGroup {
  device: string;
  root: string;
}

export const useCollapsedGroups = () => {
  return useQuery({
    queryKey: ["collapsed-groups"],
    queryFn: () => {
      return api<CollapsedGroup[]>("/sidebar/collapsed");
    },
  });
};

export const useSetCollapsed = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CollapsedGroup & { collapsed: boolean }) => {
      return api<unknown>("/sidebar/collapsed", { method: "PUT", body: input });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["collapsed-groups"] });
    },
  });
};

// The tools remembered as always allowed in a project.
export const useRules = () => {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => {
      return api<PermissionRule[]>("/rules");
    },
  });
};

export const useRemoveRule = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => {
      return api<unknown>(`/rules/${String(id)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["rules"] });
    },
  });
};

// Changes how a conversation treats changes.
export const useSetMode = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mode: PermissionMode) => {
      return api<SessionInfo>(`/sessions/${id}/mode`, { method: "PUT", body: { mode } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
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

// Pins a conversation to the top of the sidebar, or unpins it. The pin is kept on the gateway with the conversation.
export const usePinConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) => {
      return api<SessionInfo>(`/sessions/${input.id}`, { method: "PATCH", body: { pinned: input.pinned } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Puts a conversation away in the Archive section of the sidebar, or brings it back. Nothing is deleted.
export const useArchiveConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => {
      return api<SessionInfo>(`/sessions/${input.id}`, { method: "PATCH", body: { archived: input.archived } });
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
