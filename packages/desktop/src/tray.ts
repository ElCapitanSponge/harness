import type { AgentState } from "./agent-host.js";
import { needsYouLabel } from "./badge.js";

// The tray (or menu bar) menu, described as plain data so it can be tested; main.ts turns it into Electron's menu.

export interface MenuSpec {
  label?: string;
  type?: "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  click?: () => void;
}

export interface TrayActions {
  open: () => void;
  openInBrowser: () => void;
  changeGateway: () => void;
  startAgent: () => void;
  stopAgent: () => void;
  toggleLogin: (enabled: boolean) => void;
  quit: () => void;
}

// What the agent is doing, in words for the person.
export const stateLabel = (state: AgentState): string => {
  switch (state) {
    case "connected":
      return "Connected to the gateway";
    case "running":
      return "Agent running, not connected yet";
    case "starting":
      return "Agent starting";
    case "failed":
      return "Agent stopped after repeated failures";
    case "stopped":
      return "Agent stopped";
  }
};

export const trayMenu = (state: AgentState, gateway: string | undefined, openAtLogin: boolean, actions: TrayActions, needYou = 0): MenuSpec[] => {
  const on = state === "connected" || state === "running" || state === "starting";
  return [
    ...(needYou > 0 ? [{ label: needsYouLabel(needYou), enabled: false }, { type: "separator" as const }] : []),
    { label: stateLabel(state), enabled: false },
    ...(gateway ? [{ label: gateway, enabled: false }] : []),
    { type: "separator" },
    { label: "Open Torii", click: actions.open },
    { label: "Open in the browser", enabled: gateway !== undefined, click: actions.openInBrowser },
    { type: "separator" },
    { label: on ? "Stop the agent on this device" : "Start the agent on this device", enabled: gateway !== undefined, click: on ? actions.stopAgent : actions.startAgent },
    { label: "Change gateway...", click: actions.changeGateway },
    { label: "Start at login", type: "checkbox", checked: openAtLogin, click: () => {
      actions.toggleLogin(!openAtLogin);
    } },
    { type: "separator" },
    { label: "Quit Torii", click: actions.quit },
  ];
};
