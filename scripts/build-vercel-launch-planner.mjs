import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();

await build({
  entryPoints: [path.join(root, "backend", "api", "src", "launch-service.ts")],
  bundle: true,
  // Bundle the launcher's Solana and Pump SDK dependency tree. Vercel's
  // Node 24 runtime can otherwise resolve rpc-websockets to a CJS/ESM-incompatible
  // uuid package at invocation time.
  packages: "bundle",
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(root, "api", "v1", "launch-planner.cjs"),
  logLevel: "info",
});
