import { ChevronDown, Code2, Laptop, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { useNodes } from "@/lib/queries";
import { guideFor } from "@/lib/thisdevice";
import { useThisDevice } from "@/lib/useThisDevice";

// The sidebar's one New button, split in two: the main part starts a conversation, and the arrow opens a menu with "New code session". A
// coding session needs an agent, because a browser cannot read files, so that item is off while no device has one. When the gateway knows
// which device the browser is on, the session starts there ("New code session here"); if it cannot tell, or there is none, it says so and
// asks once.
export const ThisDevice = ({ onNavigate }: { onNavigate: () => void }) => {
  const navigate = useNavigate();
  const nodes = useNodes();
  const { here, choice, choose } = useThisDevice();
  const agents = (nodes.data ?? []).filter((n) => {
    return (n.roots?.length ?? 0) > 0;
  });
  const guide = guideFor(navigator.userAgent);
  const go = (to: string) => {
    void navigate(to);
    onNavigate();
  };
  const nodeId = here.state === "device" ? here.nodeId : undefined;
  const noAgents = agents.length === 0;

  return (
    <div className="grid gap-1">
      <div className="flex">
        <Button variant="primary" size="lg" className="min-w-0 flex-1 justify-start rounded-r-none" onClick={() => {
          go("/");
        }}
        >
          <Plus /> New conversation
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="primary" size="lg" className="rounded-l-none border-l border-primary-foreground/30 px-2" aria-label="More ways to start">
              <ChevronDown />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => {
              go("/");
            }}
            >
              <Plus /> New conversation
            </MenuItem>
            <MenuItem
              disabled={noAgents}
              onSelect={() => {
                go(nodeId === undefined ? "/?mode=code" : `/?mode=code&device=${encodeURIComponent(nodeId)}`);
              }}
            >
              {nodeId === undefined ? <Code2 /> : <Laptop />} {nodeId === undefined ? "New code session" : "New code session here"}
            </MenuItem>
            {noAgents ? <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">No device has an agent connected, so a coding session cannot start.</p> : null}
          </MenuContent>
        </Menu>
      </div>

      {nodeId === undefined
        ? (
            <div className="grid gap-1 rounded-md border p-2 text-xs text-muted-foreground" role="group" aria-label="This device">
              {here.state === "none"
                ? (
                    <p>
                      There is no agent on this device, so a coding session cannot work on its files (a browser cannot read them). Set one up for {guide.os}:{" "}
                      <a className="underline" href={guide.href} target="_blank" rel="noreferrer">the {guide.os} guide</a>.
                    </p>
                  )
                : <p>Which device is this? Choose it to start coding sessions on its folders.</p>}
              <Select aria-label="This device is" className="h-8 text-xs" value={choice ?? ""} onChange={(ev) => {
                choose(ev.target.value === "" ? undefined : ev.target.value);
              }}
              >
                <option value="">Not sure</option>
                {agents.map((n) => {
                  return <option key={n.nodeId} value={n.nodeId}>{n.nodeId}</option>;
                })}
                <option value="none">None: no agent on this device</option>
              </Select>
            </div>
          )
        : (
            <p className="px-1 text-xs text-muted-foreground">
              This device is {nodeId}.{" "}
              <button type="button" className="underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center" onClick={() => {
                choose("none");
              }}
              >
                Not right?
              </button>
            </p>
          )}
    </div>
  );
};
