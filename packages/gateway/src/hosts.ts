import { execFile } from "node:child_process";

export type TailscaleIp = () => Promise<string>;

export const tailscaleIp: TailscaleIp = () => {
  return new Promise((resolve, reject) => {
    execFile("tailscale", ["ip", "-4"], { timeout: 5000 }, (err, stdout, stderr) => {
      const ip = stdout.trim().split("\n")[0]?.trim();
      if (err || !ip) {
        reject(new Error([stderr.trim(), stdout.trim(), err?.message ?? ""].find((text) => {
          return text !== "";
        }) ?? "no Tailscale address"));
      } else {
        resolve(ip);
      }
    });
  });
};

// HOST is a comma-separated list. The word "tailscale" means this machine's Tailscale IPv4 address.
// If Tailscale is not connected that entry is skipped with a warning, so local use keeps working.
export const resolveHosts = async (
  spec: string,
  lookup: TailscaleIp = tailscaleIp,
  warn: (msg: string) => void = console.warn,
): Promise<string[]> => {
  const hosts: string[] = [];
  for (const part of spec.split(",").map((s) => {
    return s.trim();
  }).filter(Boolean)) {
    if (part !== "tailscale") {
      hosts.push(part);
      continue;
    }
    try {
      hosts.push(await lookup());
    } catch (err) {
      warn(`[gateway] skipping "tailscale": ${(err as Error).message.split("\n")[0]}`);
    }
  }
  const unique = [...new Set(hosts)];
  if (unique.length === 0) {
    throw new Error(`no usable listen address in HOST="${spec}"`);
  }
  return unique;
};
