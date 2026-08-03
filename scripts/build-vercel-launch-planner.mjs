import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();

await build({
  entryPoints: [path.join(root, "backend", "api", "src", "launch-service.ts")],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(root, "api", "v1", "launch-planner.cjs"),
  logLevel: "info",
});
