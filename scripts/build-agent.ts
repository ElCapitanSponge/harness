import path from "node:path";
import { build } from "esbuild";

// Bundles the node agent into one JavaScript file that plain `node` runs, so a device does not need pnpm and tsx running beside it
// (together they were more than half of the agent's memory). The workspace packages and their dependencies are bundled in; only
// Playwright, which the optional browser loads on first use, stays outside.

export const AGENT_ENTRY = path.resolve(import.meta.dirname, "../packages/node-agent/src/index.ts");
export const AGENT_BUNDLE = path.resolve(import.meta.dirname, "../packages/node-agent/dist/agent.mjs");

export const buildAgent = async (outfile: string = AGENT_BUNDLE): Promise<void> => {
  await build({
    entryPoints: [AGENT_ENTRY],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["playwright-core"],
    // Some bundled packages use require().
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: "warning",
  });
};

// `tsx scripts/build-agent.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await buildAgent();
  console.log(`built ${path.relative(process.cwd(), AGENT_BUNDLE)}`);
}
