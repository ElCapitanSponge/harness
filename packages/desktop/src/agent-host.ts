import type { DesktopConfig } from "./config.js";

// Runs this machine's node agent for the app: start, stop, restart after a crash, and say whether it is connected to the gateway. The
// process and the network are handed in, so the lifecycle can be tested without either.

export type AgentState = "stopped" | "starting" | "running" | "connected" | "failed";

export interface ChildLike {
  pid?: number;
  onExit: (listener: (code: number | null) => void) => void;
  onOutput: (listener: (text: string) => void) => void;
  kill: () => void;
}

export interface AgentHostOptions {
  // Starts the agent with this environment.
  spawn: (env: Record<string, string>) => ChildLike;
  // Whether the gateway lists this device.
  connected: (config: DesktopConfig) => Promise<boolean>;
  // Where the agent keeps its settings and audit log.
  dataDir: string;
  onState?: (state: AgentState) => void;
  log?: (text: string) => void;
  // Restart delays after a crash, in order; after the last, the agent is left failed.
  restartDelaysMs?: number[];
  wait?: (ms: number) => Promise<void>;
}

// The environment the agent is started with: the gateway and key, this machine's name, remote configuration on (so everything else is set
// from the Devices page), and its files in the app's data folder. Nothing is read from a .env.
export const agentEnv = (config: DesktopConfig, dataDir: string, base: Record<string, string | undefined> = {}): Record<string, string> => {
  const env: Record<string, string> = {};
  // Only what the agent needs from the environment it was started in, not the app's own settings.
  for (const name of ["PATH", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "SYSTEMROOT", "TEMP", "TMP", "LANG", "SHELL", "ProgramFiles", "ProgramFiles(x86)", "SSH_AUTH_SOCK"]) {
    const value = base[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return {
    ...env,
    GATEWAY_URL: config.gatewayUrl,
    HARNESS_API_KEY: config.key,
    NODE_ID: config.nodeId,
    REMOTE_CONFIG: "1",
    SETTINGS_FILE: `${dataDir}/agent-settings.json`,
    AUDIT_LOG: `${dataDir}/audit.log`,
    ELECTRON_RUN_AS_NODE: "1",
  };
};

export const createAgentHost = (opts: AgentHostOptions) => {
  const delays = opts.restartDelaysMs ?? [2000, 5000, 15000, 30000];
  const wait = opts.wait ?? ((ms: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
  const log = opts.log ?? (() => {
    return undefined;
  });
  let state: AgentState = "stopped";
  let child: ChildLike | undefined;
  let config: DesktopConfig | undefined;
  // Bumped on every start and stop, so a stale exit or poll from an earlier run does nothing.
  let run = 0;
  let crashes = 0;

  const set = (next: AgentState): void => {
    if (next !== state) {
      state = next;
      opts.onState?.(state);
    }
  };

  const launch = (): void => {
    if (!config) {
      return;
    }
    const mine = ++run;
    set("starting");
    const started = opts.spawn(agentEnv(config, opts.dataDir, process.env));
    child = started;
    started.onOutput((text) => {
      log(text);
    });
    started.onExit((code) => {
      if (mine !== run) {
        return;
      }
      child = undefined;
      log(`the agent exited with ${String(code)}`);
      const delay = delays[crashes];
      crashes++;
      if (delay === undefined) {
        set("failed");
        return;
      }
      set("starting");
      void wait(delay).then(() => {
        if (mine === run) {
          launch();
        }
      });
    });
    set("running");
  };

  return {
    state: (): AgentState => {
      return state;
    },
    start(next: DesktopConfig): void {
      this.stop();
      config = next;
      crashes = 0;
      launch();
    },
    stop(): void {
      run++;
      const old = child;
      child = undefined;
      old?.kill();
      set("stopped");
    },
    // Looks at the gateway to see whether this device is listed, and moves between running and connected.
    async refresh(): Promise<AgentState> {
      const mine = run;
      if (!config || (state !== "running" && state !== "connected")) {
        return state;
      }
      const listed = await opts.connected(config).catch(() => {
        return false;
      });
      if (mine === run) {
        if (listed) {
          crashes = 0;
        }
        set(listed ? "connected" : "running");
      }
      return state;
    },
  };
};

export type AgentHost = ReturnType<typeof createAgentHost>;
