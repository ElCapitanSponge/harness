import { Laptop } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { useNodes } from "@/lib/queries";
import { guideFor } from "@/lib/thisdevice";
import { useThisDevice } from "@/lib/useThisDevice";

// "New code session here": starts a coding session on the device the browser is on, which needs an agent there because a browser cannot
// read files. If the gateway cannot tell which device this is, or there is none, it says so and asks once.
export const ThisDevice = ({ onNavigate }: { onNavigate: () => void }) => {
  const navigate = useNavigate();
  const nodes = useNodes();
  const { here, choice, choose } = useThisDevice();
  const agents = (nodes.data ?? []).filter((n) => {
    return (n.roots?.length ?? 0) > 0;
  });
  const guide = guideFor(navigator.userAgent);

  if (here.state === "device") {
    const nodeId = here.nodeId;
    return (
      <div className="grid gap-1">
        <Button size="lg" className="justify-start" onClick={() => {
          void navigate(`/?mode=code&device=${encodeURIComponent(nodeId)}`);
          onNavigate();
        }}
        >
          <Laptop /> New code session here
        </Button>
        <p className="px-1 text-xs text-muted-foreground">
          This device is {nodeId}.{" "}
          <button type="button" className="underline" onClick={() => {
            choose("none");
          }}
          >
            Not right?
          </button>
        </p>
      </div>
    );
  }

  return (
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
  );
};
