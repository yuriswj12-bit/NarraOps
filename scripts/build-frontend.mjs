import esbuild from "esbuild";

const publicEnv = {
  __NARRAOPS_SUPABASE_URL__: JSON.stringify(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  ),
  __NARRAOPS_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  ),
};

await esbuild.build({
  entryPoints: ["frontend/src/app.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "app.js",
  define: publicEnv,
});
