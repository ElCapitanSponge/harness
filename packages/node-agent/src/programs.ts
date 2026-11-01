import { spawn } from "node:child_process";

// Which of the programs the tools need are on this device. Each is asked for its version, with a short time limit, so a tool is
// offered to the model only if it can run.
const probe = (program: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const child = spawn(program, ["--version"], { stdio: "ignore", shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
};

export const detectPrograms = async (programs: string[]): Promise<Set<string>> => {
  const unique = [...new Set(programs)];
  const found = await Promise.all(unique.map(probe));
  return new Set(unique.filter((_p, i) => {
    return found[i];
  }));
};
