import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "dist", "vercel");

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

const files = [
  "index.html",
  "app.html",
  "app.js",
  "app-20260729-pulse-market-history-v2.js",
  "styles.css",
];
for (const file of files) {
  await cp(path.join(root, file), path.join(outputDir, file));
}

await cp(path.join(root, "assets"), path.join(outputDir, "assets"), { recursive: true });
