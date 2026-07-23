declare const __NARRAOPS_SUPABASE_URL__: string | undefined;
declare const __NARRAOPS_SUPABASE_PUBLISHABLE_KEY__: string | undefined;

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
  configured: boolean;
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = typeof __NARRAOPS_SUPABASE_URL__ === "string" ? __NARRAOPS_SUPABASE_URL__.trim() : "";
  const publishableKey =
    typeof __NARRAOPS_SUPABASE_PUBLISHABLE_KEY__ === "string"
      ? __NARRAOPS_SUPABASE_PUBLISHABLE_KEY__.trim()
      : "";

  return {
    url,
    publishableKey,
    configured: Boolean(url && publishableKey),
  };
}
