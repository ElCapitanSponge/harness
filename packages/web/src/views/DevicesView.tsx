import { Check, Copy, Lock, Monitor, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Switch, Textarea } from "@/components/ui/fields";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlay";
import { keyStore } from "@/lib/api";
import { useDeviceSettings, useNodes, useSaveSettings } from "@/lib/queries";
import type { NodeRecord, SettingKey, SettingsReport } from "@/lib/types";
import { cn } from "@/lib/utils";

type Access = "off" | "read" | "change";
type ToolInfo = NonNullable<SettingsReport["tools"]>[number];

const SETTING_ENV: Record<SettingKey, string> = {
  projectRoots: "PROJECT_ROOTS",
  readOnlyRoots: "READ_ONLY_ROOTS",
  onDeviceTools: "ALLOW_ON_DEVICE_TOOLS",
  remoteTools: "ALLOW_REMOTE_TOOLS",
  modelControl: "ALLOW_MODEL_CONTROL",
  claude: "CLAUDE_ENABLED",
  gameProcesses: "GAME_PROCESSES",
  idleUnloadMinutes: "IDLE_UNLOAD_MINUTES",
};

const ACCESS: { value: Access; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read-only" },
  { value: "change", label: "Can change" },
];

const Field = ({ name, label, report, children }: { name: SettingKey; label: string; report: SettingsReport; children: React.ReactNode }) => {
  const locked = report.locked.includes(name);
  const source = report.sources[name];
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{label}</span>
        {locked ? <Badge tone="warning"><Lock className="size-3" /> fixed by {SETTING_ENV[name]}</Badge> : <Badge>{source === "file" ? "set from here" : "default"}</Badge>}
      </div>
      {children}
    </div>
  );
};

// One group of tools: off, read-only or able to change things, and which tools that gives.
const ToolGroupControl = ({ group, label, hint, value, onChange, disabled, tools }: { group: "device" | "remote"; label: string; hint: string; value: Access; onChange: (value: Access) => void; disabled: boolean; tools: ToolInfo[] }) => {
  const members = tools.filter((t) => {
    return t.group === group;
  });
  const included = (t: ToolInfo): boolean => {
    return value === "change" || (value === "read" && t.level === "read");
  };
  return (
    <div className="grid gap-2">
      <div className="inline-flex w-fit rounded-lg border bg-card p-0.5" role="radiogroup" aria-label={label}>
        {ACCESS.map((a) => {
          return (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={value === a.value}
              disabled={disabled}
              className={cn("rounded-md px-3 py-1 font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60", value === a.value && "bg-accent text-accent-foreground")}
              onClick={() => {
                onChange(a.value);
              }}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {members.length > 0
        ? (
            <ul className="grid gap-x-5 gap-y-1 sm:grid-cols-2" aria-label={`${label}: tools`}>
              {members.map((t) => {
                return (
                  <li key={t.name} className={cn("flex flex-wrap items-center gap-1.5 font-mono text-[13px]", !included(t) && "text-muted-foreground opacity-60")}>
                    {t.name}
                    {t.asksFirst ? <Badge tone="warning">asks first</Badge> : null}
                    {t.installed ? null : <Badge tone="danger">not installed</Badge>}
                  </li>
                );
              })}
            </ul>
          )
        : null}
    </div>
  );
};

const rootsText = (roots: Record<string, string>): string => {
  return Object.entries(roots).map(([name, dir]) => {
    return `${name}=${dir}`;
  }).join("\n");
};

const parseRoots = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(i + 1).trim()) {
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
};

const SettingsForm = ({ node, report }: { node: NodeRecord; report: SettingsReport }) => {
  const save = useSaveSettings(node.nodeId);
  const [roots, setRoots] = useState(rootsText(report.settings.projectRoots));
  const [readOnly, setReadOnly] = useState(report.settings.readOnlyRoots);
  const [onDevice, setOnDevice] = useState<Access>(report.settings.onDeviceTools);
  const [remote, setRemote] = useState<Access>(report.settings.remoteTools);
  const [modelControl, setModelControl] = useState(report.settings.modelControl);
  const [claude, setClaude] = useState(report.settings.claude);
  const [games, setGames] = useState(report.settings.gameProcesses.join(", "));
  const [idle, setIdle] = useState(String(report.settings.idleUnloadMinutes));
  const off = (name: SettingKey): boolean => {
    return !report.remoteConfig || report.locked.includes(name);
  };
  const rootNames = Object.keys(parseRoots(roots));

  const submit = (): void => {
    const all: Record<SettingKey, unknown> = {
      projectRoots: parseRoots(roots),
      // Only names that are still folders, so removing a folder does not leave a stale name behind.
      readOnlyRoots: readOnly.filter((name) => {
        return rootNames.includes(name);
      }),
      onDeviceTools: onDevice,
      remoteTools: remote,
      modelControl,
      claude,
      idleUnloadMinutes: Math.max(0, Math.floor(Number(idle) || 0)),
      gameProcesses: games.split(",").map((s) => {
        return s.trim();
      }).filter(Boolean),
    };
    const patch = Object.fromEntries(Object.entries(all).filter(([name]) => {
      return !report.locked.includes(name as SettingKey);
    }));
    save.mutate(patch);
  };

  return (
    <div className="grid gap-4">
      <Field name="projectRoots" label="Project folders" report={report}>
        <Textarea rows={3} disabled={off("projectRoots")} value={roots} aria-label="Project folders, name=path, one per line" placeholder="name=path, one per line" className="font-mono text-[13px]" onChange={(ev) => {
          setRoots(ev.target.value);
        }}
        />
      </Field>
      <Field name="readOnlyRoots" label="Folders that can only be read" report={report}>
        {rootNames.length === 0
          ? <p className="text-xs text-muted-foreground">Add a project folder first.</p>
          : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {rootNames.map((name) => {
                  return (
                    <label key={name} className="flex items-center gap-2 text-[13px]">
                      <Switch disabled={off("readOnlyRoots")} checked={readOnly.includes(name)} aria-label={`${name} is read-only`} onCheckedChange={(checked) => {
                        setReadOnly(checked ? [...readOnly, name] : readOnly.filter((n) => {
                          return n !== name;
                        }));
                      }}
                      />
                      <span className="font-mono">{name}</span>
                      <span className="text-xs text-muted-foreground">{readOnly.includes(name) ? "read only" : "can be changed"}</span>
                    </label>
                  );
                })}
              </div>
            )}
        <p className="text-xs text-muted-foreground">Nothing in a read-only folder can be written, edited, deleted or committed, and commands do not run there. Sessions there are not offered the tools that could.</p>
      </Field>
      <Field name="onDeviceTools" label="Tools on this device" report={report}>
        <ToolGroupControl group="device" label="Tools on this device" hint="Work on this machine's files and programs: reading files, searching, git, jq, fzf. Can change adds writing and editing files, running commands and committing, which always ask first." value={onDevice} onChange={setOnDevice} disabled={off("onDeviceTools")} tools={report.tools ?? []} />
      </Field>
      <Field name="remoteTools" label="Tools that reach out" report={report}>
        <ToolGroupControl group="remote" label="Tools that reach out" hint="Go beyond this machine: fetching web pages and GitHub. Can change adds opening pull requests and comments, which always ask first. Fetching a page asks each time." value={remote} onChange={setRemote} disabled={off("remoteTools")} tools={report.tools ?? []} />
      </Field>
      <Field name="modelControl" label="Let the gateway load and unload models" report={report}>
        <Switch disabled={off("modelControl")} checked={modelControl} aria-label="Model control" onCheckedChange={setModelControl} />
      </Field>
      <Field name="claude" label="Answer Claude requests with this device's claude login" report={report}>
        <Switch disabled={off("claude")} checked={claude} aria-label="Claude" onCheckedChange={setClaude} />
      </Field>
      <Field name="idleUnloadMinutes" label="Unload a model nobody has used for (minutes, 0 never)" report={report}>
        <Input type="number" min={0} max={1440} className="w-28" disabled={off("idleUnloadMinutes")} value={idle} aria-label="Minutes before an unused model is unloaded" onChange={(ev) => {
          setIdle(ev.target.value);
        }}
        />
        <p className="text-xs text-muted-foreground">Frees the graphics card for other things. Only models Torii used are unloaded, and only if model control is on. The next message loads it again.</p>
      </Field>
      <Field name="gameProcesses" label="Game programs that make the device busy" report={report}>
        <Input disabled={off("gameProcesses")} value={games} aria-label="Game programs, comma separated" onChange={(ev) => {
          setGames(ev.target.value);
        }}
        />
      </Field>

      {report.remoteConfig
        ? (
            <div className="flex items-center gap-3">
              <Button variant="primary" disabled={save.isPending} onClick={submit}>Save settings</Button>
              {save.isSuccess ? <span className="text-success" role="status">Saved. It applies now, with no restart.</span> : null}
              {save.error ? <span className="text-destructive" role="alert">Not saved: {save.error.message}</span> : null}
            </div>
          )
        : null}
    </div>
  );
};

const DeviceCard = ({ node }: { node: NodeRecord }) => {
  const settings = useDeviceSettings(node.nodeId);
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Monitor className="size-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">{node.nodeId}</h2>
        {node.platform ? <Badge>{node.platform}</Badge> : null}
        {node.busy ? <Badge tone="warning">busy{node.busyReason ? `: ${node.busyReason}` : ""}</Badge> : <Badge tone="success">ready</Badge>}
        <Badge tone="brand">{node.models.length} model{node.models.length === 1 ? "" : "s"}</Badge>
      </div>
      {settings.isPending ? <p className="text-muted-foreground">Loading settings...</p> : null}
      {settings.error ? <p className="text-muted-foreground">Its settings cannot be read: {settings.error.message}. An older agent does not support this; update it.</p> : null}
      {settings.data
        ? (
            <>
              <p className="text-muted-foreground">
                {settings.data.remoteConfig ? "This device accepts settings changes from here." : "Read-only: start its agent with REMOTE_CONFIG=1 to change settings from here."}
              </p>
              <SettingsForm node={node} report={settings.data} />
            </>
          )
        : null}
    </section>
  );
};

const AddDevice = () => {
  const [copied, setCopied] = useState("");
  const origin = window.location.origin;
  const commands = [
    { label: "Windows (PowerShell)", build: (k: string) => {
      return `$env:GATEWAY_URL='${origin}'; $env:HARNESS_API_KEY='${k}'; $env:REMOTE_CONFIG='1'; pnpm agent`;
    } },
    { label: "Linux or macOS", build: (k: string) => {
      return `GATEWAY_URL=${origin} HARNESS_API_KEY=${k} REMOTE_CONFIG=1 pnpm agent`;
    } },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button><Plus /> Add a device</Button>
      </DialogTrigger>
      <DialogContent title="Add a device" description="Run this from a clone of the repository on the new machine, after pnpm install. REMOTE_CONFIG=1 lets this page change its settings; leave it out to keep the device read-only. The key is copied, not shown.">
        <div className="grid gap-2">
          {commands.map((c) => {
            return (
              <div key={c.label} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <span className="font-semibold">{c.label}</span>
                <Button onClick={() => {
                  void navigator.clipboard.writeText(c.build(keyStore.state)).then(() => {
                    setCopied(c.label);
                  });
                }}
                >
                  {copied === c.label ? <Check /> : <Copy />} {copied === c.label ? "Copied" : "Copy command"}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const DevicesView = () => {
  const nodes = useNodes();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Devices</h1>
            <p className="text-muted-foreground">What each connected device lets the gateway do.</p>
          </div>
          <AddDevice />
        </div>
        {nodes.isPending ? <p className="text-muted-foreground">Loading...</p> : null}
        {nodes.data?.length === 0 ? <p className="text-muted-foreground">No device is connected.</p> : null}
        {nodes.data?.map((n) => {
          return <DeviceCard key={n.nodeId} node={n} />;
        })}
      </div>
    </div>
  );
};
