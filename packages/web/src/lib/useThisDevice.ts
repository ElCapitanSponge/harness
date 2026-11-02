import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { useNodes } from "./queries";
import { desktopApi } from "./desktop";
import { THIS_DEVICE_KEY, readStored, resolveThisDevice, writeStored, type ThisDevice } from "./thisdevice";

// Which connected device the browser is on, and a way for the person to say. The gateway's guess comes from /whoami.
export const useThisDevice = (): { here: ThisDevice; choose: (choice: string | undefined) => void; choice: string | undefined } => {
  const nodes = useNodes();
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => {
      return api<{ address?: string; devices: string[] }>("/whoami");
    },
    staleTime: 60_000,
  });
  const [choice, setChoice] = useState(() => {
    return readStored(THIS_DEVICE_KEY);
  });
  // In the desktop app this device is known: it is the one the app runs, with no matching and no choice.
  const app = desktopApi();
  return {
    here: app ? resolveThisDevice([app.nodeId], undefined, nodes.data ?? []) : resolveThisDevice(whoami.data?.devices ?? [], choice, nodes.data ?? []),
    choice,
    choose: (next) => {
      writeStored(THIS_DEVICE_KEY, next);
      setChoice(next);
    },
  };
};
