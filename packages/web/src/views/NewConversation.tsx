import { Code2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Composer } from "@/components/Composer";
import { effortLevels, type Effort } from "@harness/core/effort";
import { EffortPicker } from "@/components/EffortPicker";
import { ModelPicker, useModels } from "@/components/ModelPicker";
import { Select } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { useCreateConversation, useNodes } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Mode = "chat" | "code";

// The start of a conversation. Nothing is saved until the first message is sent.
export const NewConversation = () => {
  const navigate = useNavigate();
  const create = useCreateConversation();
  const nodes = useNodes();
  const [mode, setMode] = useState<Mode>("chat");
  const [model, setModel] = useState("");
  const [device, setDevice] = useState("");
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [effort, setEffort] = useState<Effort | undefined>(undefined);
  const { firstUsable } = useModels();

  const devices = (nodes.data ?? []).filter((n) => {
    return (n.roots?.length ?? 0) > 0;
  });
  const chosenDevice = devices.find((d) => {
    return d.nodeId === device;
  }) ?? devices[0];
  const roots = chosenDevice?.roots ?? [];
  const chosenRoot = roots.includes(root) ? root : (roots[0] ?? "");
  const selected = model || firstUsable;
  const ready = selected !== "" && (mode === "chat" || (chosenDevice !== undefined && chosenRoot !== ""));

  const start = async (text: string): Promise<void> => {
    setError("");
    setSending(true);
    try {
      const info = await create.mutateAsync({ model: selected, ...(mode === "code" ? { device: chosenDevice?.nodeId, root: chosenRoot } : {}) });
      await api<unknown>(`/sessions/${info.id}/messages`, { method: "POST", body: { text, ...(effortLevels(selected).length > 0 && effort ? { effort } : {}) } });
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
                </>
              )
            : null}
        </div>
        {mode === "code" && devices.length === 0 && !nodes.isPending ? <p className="max-w-xl text-center text-muted-foreground">No connected device exposes a project folder. Add one from Devices, or set PROJECT_ROOTS on a device&apos;s agent.</p> : null}
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      </div>

      <Composer draftKey="new" busy={sending} disabled={!ready} placeholder={mode === "code" ? "Describe what to do in this folder" : "Message"} onSend={(text) => {
        void start(text);
      }}
      />
    </div>
  );
};
