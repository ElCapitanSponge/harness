import { useQueryClient } from "@tanstack/react-query";
import { Code2, FolderOpen, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Composer } from "@/components/Composer";
import { effortLevels, type Effort } from "@harness/core/effort";
import { noImagesReason, supportsImages, type ImageAttachment } from "@harness/core/image";
import { EffortPicker } from "@/components/EffortPicker";
import { ModelPicker, useModels } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { useCreateConversation, useLibrary, useNodes, useSkills } from "@/lib/queries";
import { parseSlash, withLibrary } from "@/lib/skills";
import { pushRecent, readRecent } from "@/lib/thisdevice";
import { addProjectFolder } from "@/lib/addfolder";
import { resolveModel, unavailable } from "@/lib/commands";
import { desktopApi } from "@/lib/desktop";
import type { NodeRecord, SettingsReport } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mode = "chat" | "code";

// The start of a conversation. Nothing is saved until the first message is sent.
export const NewConversation = () => {
  const navigate = useNavigate();
  const create = useCreateConversation();
  const nodes = useNodes();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "code" || params.get("root") !== null ? "code" : "chat");
  const [model, setModel] = useState(params.get("model") ?? "");
  const [device, setDevice] = useState(params.get("device") ?? "");
  const [recent, setRecent] = useState(readRecent);
  const [root, setRoot] = useState(params.get("root") ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const queryClient = useQueryClient();
  const app = desktopApi();
  const [effort, setEffort] = useState<Effort | undefined>(undefined);

  const devices = (nodes.data ?? []).filter((n) => {
    return (n.roots?.length ?? 0) > 0;
  });
  const chosenDevice = devices.find((d) => {
    return d.nodeId === device;
  }) ?? devices[0];
  const roots = chosenDevice?.roots ?? [];
  const chosenRoot = roots.includes(root) ? root : (roots[0] ?? "");
  const selected = model || "auto";
  const found = useSkills(mode === "code" && chosenDevice && chosenRoot ? { device: chosenDevice.nodeId, root: chosenRoot } : undefined);
  const library = useLibrary();
  const skills = withLibrary(mode === "code" ? found.data?.[0]?.skills : undefined, library.data);
  const ready = selected !== "" && (mode === "chat" || (chosenDevice !== undefined && chosenRoot !== ""));

  // The desktop app only: the system folder picker. The folder becomes a project folder on this machine (see addProjectFolder).
  const choose = async (): Promise<void> => {
    if (!app) {
      return;
    }
    setError("");
    const folder = await app.pickFolder();
    if (!folder) {
      return;
    }
    setChoosing(true);
    const result = await addProjectFolder(app.nodeId, folder, {
      settings: (nodeId) => {
        return api<SettingsReport>(`/devices/${encodeURIComponent(nodeId)}/settings`);
      },
      save: (nodeId, projectRoots) => {
        return api<unknown>(`/devices/${encodeURIComponent(nodeId)}/settings`, { method: "PUT", body: { projectRoots } });
      },
      nodes: () => {
        return api<NodeRecord[]>("/nodes");
      },
    });
    setChoosing(false);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      setMode("code");
      setDevice(app.nodeId);
      setRoot(result.root);
    } else {
      setError(result.error);
    }
  };

  // The built-in commands on the start screen: only /model has anything to act on before a conversation exists.
  const { catalogue } = useModels();
  const [notice, setNotice] = useState("");
  const runCommand = (name: string, args: string): void => {
    setNotice("");
    const why = unavailable(name, { conversation: false, code: false });
    if (why) {
      setNotice(why);
      return;
    }
    if (args === "") {
      setNotice(`The first message goes to ${selected}. Choose another in the model box above, or type /model and a name.`);
      return;
    }
    const data = catalogue.data;
    const found = resolveModel(args, ["auto", ...(data?.models ?? []).filter((m) => {
      return m.state === "loaded" || m.state === "loads-on-use";
    }).map((m) => {
      return m.id;
    }), ...(data?.claude.available ? data.claude.models : [])]);
    if ("error" in found) {
      setNotice(found.error);
    } else {
      setModel(found.id);
      setNotice(`The first message goes to ${found.id}.`);
    }
  };

  const start = async (text: string, images?: ImageAttachment[]): Promise<void> => {
    setError("");
    setSending(true);
    try {
      if (mode === "code" && chosenDevice && chosenRoot) {
        setRecent(pushRecent({ device: chosenDevice.nodeId, root: chosenRoot }));
      }
      const info = await create.mutateAsync({ model: selected, ...(mode === "code" ? { device: chosenDevice?.nodeId, root: chosenRoot } : {}) });
      await api<unknown>(`/sessions/${info.id}/messages`, { method: "POST", body: { text, ...(images ? { images } : {}), ...(parseSlash(text, skills ?? []) ? { skill: parseSlash(text, skills ?? []) } : {}), ...(effortLevels(selected).length > 0 && effort ? { effort } : {}) } });
      await navigate(`/c/${info.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.");
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto overflow-x-hidden p-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">What shall we work on?</h1>
          <p className="mt-1 text-muted-foreground">Chat with any model on your devices or Claude, or code in a folder on a device.</p>
        </div>

        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Kind of conversation">
          {([["chat", "Chat", MessageSquare], ["code", "Code", Code2]] as const).map(([value, label, Icon]) => {
            return (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                className={cn("inline-flex items-center gap-2 rounded-md px-4 py-1.5 font-semibold text-muted-foreground hover:text-foreground", mode === value && "bg-accent text-accent-foreground")}
                onClick={() => {
                  setMode(value);
                }}
              >
                <Icon className="size-4" /> {label}
              </button>
            );
          })}
        </div>

        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
          <ModelPicker value={selected} onChange={setModel} className={mode === "chat" ? "sm:col-span-2" : ""} />
          <EffortPicker className="sm:col-span-2" model={selected} value={effort} onChange={setEffort} />
          {mode === "code"
            ? (
                <>
                  <Select aria-label="Device" value={chosenDevice?.nodeId ?? ""} disabled={devices.length === 0} onChange={(ev) => {
                    setDevice(ev.target.value);
                  }}
                  >
                    {devices.length === 0 ? <option value="">No device exposes a folder</option> : null}
                    {devices.map((d) => {
                      return <option key={d.nodeId} value={d.nodeId}>{d.nodeId}</option>;
                    })}
                  </Select>
                  <Select aria-label="Project folder" className="sm:col-start-2" value={chosenRoot} disabled={roots.length === 0} onChange={(ev) => {
                    setRoot(ev.target.value);
                  }}
                  >
                    {roots.map((r) => {
                      return <option key={r} value={r}>{r}</option>;
                    })}
                  </Select>
                  {app
                    ? (
                        <Button type="button" className="sm:col-span-2" disabled={choosing} onClick={() => {
                          void choose();
                        }}
                        >
                          <FolderOpen /> {choosing ? "Adding the folder..." : "Choose a folder..."}
                        </Button>
                      )
                    : null}
                  {recent.length > 0
                    ? (
                        <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2" role="group" aria-label="Recent folders">
                          <span className="text-xs text-muted-foreground">Recent:</span>
                          {recent.filter((r) => {
                            return devices.some((d) => {
                              return d.nodeId === r.device && d.roots?.includes(r.root);
                            });
                          }).map((r) => {
                            return (
                              <button
                                key={`${r.device}/${r.root}`}
                                type="button"
                                className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted"
                                onClick={() => {
                                  setDevice(r.device);
                                  setRoot(r.root);
                                }}
                              >
                                {r.device}:{r.root}
                              </button>
                            );
                          })}
                        </div>
                      )
                    : null}
                </>
              )
            : null}
        </div>
        {mode === "code" && devices.length === 0 && !nodes.isPending ? <p className="max-w-xl text-center text-muted-foreground">No connected device exposes a project folder. Add one from Devices, or set PROJECT_ROOTS on a device&apos;s agent.</p> : null}
        {notice ? <p className="max-w-xl text-center text-muted-foreground" role="status">{notice}</p> : null}
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      </div>

      <Composer draftKey="new" onCommand={runCommand} busy={sending} disabled={!ready} skills={skills} imageNote={selected === "auto" || supportsImages(selected) ? "" : noImagesReason(selected)} placeholder={mode === "code" ? "Describe what to do in this folder" : "Message"} onSend={(text, images) => {
        void start(text, images);
      }}
      />
    </div>
  );
};
