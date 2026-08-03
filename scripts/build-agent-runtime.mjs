import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();
const entryPoint = path.join(root, "api", "v1", "agent", "runtime.ts");
const outfile = path.join(root, "api", "v1", "agent", "runtime.cjs");

await build({
  entryPoints: [entryPoint],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  logLevel: "info",
});
