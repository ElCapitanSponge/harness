import { Check, Copy, Lock, Monitor, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Checkbox, Input, Switch, Textarea } from "@/components/ui/fields";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlay";
import { keyStore } from "@/lib/api";
import { useDeviceSettings, useNodes, useSaveSettings } from "@/lib/queries";
import type { NodeRecord, SettingKey, SettingsReport } from "@/lib/types";

const TOOL_NAMES = ["read_file", "list_dir", "grep", "write_file", "edit_file", "run_command"];
const SETTING_ENV: Record<SettingKey, string> = { projectRoots: "PROJECT_ROOTS", allowedTools: "ALLOWED_TOOLS", modelControl: "ALLOW_MODEL_CONTROL", claude: "CLAUDE_ENABLED", gameProcesses: "GAME_PROCESSES" };

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
  const [tools, setTools] = useState(report.settings.allowedTools);
  const [modelControl, setModelControl] = useState(report.settings.modelControl);
  const [claude, setClaude] = useState(report.settings.claude);
  const [games, setGames] = useState(report.settings.gameProcesses.join(", "));
  const off = (name: SettingKey): boolean => {
    return !report.remoteConfig || report.locked.includes(name);
  };

  const submit = (): void => {
    const all: Record<SettingKey, unknown> = {
      projectRoots: parseRoots(roots),
      allowedTools: tools,
      modelControl,
      claude,
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
      <Field name="allowedTools" label="Tools coding sessions may run" report={report}>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TOOL_NAMES.map((name) => {
            return (
              <label key={name} className="flex items-center gap-2 font-mono text-[13px]">
                <Checkbox disabled={off("allowedTools")} checked={tools.includes(name)} onCheckedChange={(checked) => {
                  setTools(checked === true ? [...tools, name] : tools.filter((t) => {
                    return t !== name;
                  }));
                }}
                />
                {name}
              </label>
            );
          })}
        </div>
      </Field>
      <Field name="modelControl" label="Let the gateway load and unload models" report={report}>
        <Switch disabled={off("modelControl")} checked={modelControl} aria-label="Model control" onCheckedChange={setModelControl} />
      </Field>
      <Field name="claude" label="Answer Claude requests with this device's claude login" report={report}>
        <Switch disabled={off("claude")} checked={claude} aria-label="Claude" onCheckedChange={setClaude} />
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
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-6">
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
