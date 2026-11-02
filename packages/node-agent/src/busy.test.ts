import { describe, expect, it } from "vitest";
import { detectBusy, detectLoad, parsePs, parseTasklist } from "./busy.js";

describe("parseTasklist", () => {
  it("extracts lower-cased image names from csv lines, including CRLF and blanks", () => {
    const out = parseTasklist("\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"\r\n\"RocketLeague.exe\",\"4242\",\"Console\",\"1\",\"1,234,567 K\"\r\n\r\n");
    expect(out).toEqual(new Set(["system idle process", "rocketleague.exe"]));
  });
});

describe("parsePs", () => {
  it("takes the command name, ignoring paths, case and blanks", () => {
    expect(parsePs("/usr/bin/Steam\n  bash \n\n/opt/game/CS2\n")).toEqual(new Set(["steam", "bash", "cs2"]));
  });
});

describe("detectBusy", () => {
  const running = async () => {
    return new Set(["chrome.exe", "cs2.exe"]);
  };

  it("reports busy with the name of the game that matched", async () => {
    expect(await detectBusy(["eldenring.exe", "cs2.exe"], running)).toEqual({ busy: true, reason: "game running: cs2.exe" });
  });

  it("matches the configured name case-insensitively", async () => {
    expect((await detectBusy(["CS2.EXE"], running)).busy).toBe(true);
  });

  it("reports idle when no configured game is running", async () => {
    expect(await detectBusy(["eldenring.exe"], running)).toEqual({ busy: false });
  });

  it("reports idle without even listing processes when no games are configured", async () => {
    let listed = false;
    expect(
      await detectBusy([], async () => {
        listed = true;
        return new Set();
      }),
    ).toEqual({ busy: false });
    expect(listed).toBe(false);
  });

  it("reports idle if the process list cannot be read", async () => {
    const broken = async (): Promise<Set<string>> => {
      throw new Error("tasklist not found");
    };
    expect(await detectBusy(["cs2.exe"], broken)).toEqual({ busy: false });
  });
});

describe("detectLoad", () => {
  const running = (...names: string[]) => {
    return () => {
      return Promise.resolve(new Set(names.map((n) => {
        return n.toLowerCase();
      })));
    };
  };

  it("limits the device while a call is running, without making it busy", async () => {
    expect(await detectLoad(["RocketLeague.exe"], ["ms-teams.exe"], 8, running("MS-Teams.exe", "chrome.exe"))).toEqual({
      busy: false,
      limit: { reason: "ms-teams is running", maxBytes: 8e9 },
    });
  });

  it("makes the device busy for a game, which wins over a call", async () => {
    expect(await detectLoad(["RocketLeague.exe"], ["ms-teams.exe"], 8, running("RocketLeague.exe", "ms-teams.exe"))).toEqual({ busy: true, reason: "game running: RocketLeague.exe" });
  });

  it("is neither when nothing listed is running, or when the process list cannot be read", async () => {
    expect(await detectLoad(["RocketLeague.exe"], ["ms-teams.exe"], 8, running("chrome.exe"))).toEqual({ busy: false });
    expect(await detectLoad(["a.exe"], ["b.exe"], 8, () => {
      return Promise.reject(new Error("no ps"));
    })).toEqual({ busy: false });
    expect(await detectLoad([], [], 8, running("anything"))).toEqual({ busy: false });
  });
});
