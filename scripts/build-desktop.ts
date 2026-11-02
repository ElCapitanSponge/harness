import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { buildAgent } from "./build-agent.js";

// Builds everything the app runs into dist/: the main process and the two preloads (CommonJS, which Electron loads), the page that asks
// for a gateway, the icon, and the node agent bundled into one file, which the app runs for this machine.

const here = path.resolve(import.meta.dirname, "../packages/desktop");
const dist = path.join(here, "dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

for (const name of ["main", "preload", "preload-connect"]) {
  await build({
    entryPoints: [path.join(here, "src", `${name}.ts`)],
    outfile: path.join(dist, `${name}.cjs`),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    logLevel: "warning",
  });
}

await fs.copyFile(path.join(here, "src", "connect.html"), path.join(dist, "connect.html"));
await fs.copyFile(path.join(here, "resources", "icon.png"), path.join(dist, "icon.png"));
await buildAgent(path.join(dist, "agent.mjs"));
console.log("built packages/desktop/dist");
