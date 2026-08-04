import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();
const entryPoint = path.join(root, "api", "v1", "agent", "runtime.ts");
const outfile = path.join(root, "api", "v1", "agent", "runtime.cjs");

await build({
  entryPoints: [entryPoint],
  bundle: true,
  // Bundle dependencies so Vercel does not mix CommonJS rpc-websockets with
  // the ESM-only uuid package under its Node.js runtime.
  packages: "bundle",
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  logLevel: "info",
});
