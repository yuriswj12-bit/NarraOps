// @ts-nocheck
export function mockPulse() {
  return {
    mode: "unavailable",
    data_status: "data_gap",
    opportunities: [],
    reason: "Live Pulse collection is not available in this server runtime.",
  };
}

export function mockLaunchPlatforms() {
  return {
    mode: "live_confirmation_required",
    execution_enabled: true,
    platforms: [
      { id: "pump-fun", name: "Pump.fun", chain: "solana", status: "available", execution_mode: "live_confirmation_required" },
      { id: "bags", name: "BAGS", chain: "solana", status: "provider_required", execution_mode: "live_confirmation_required" },
      { id: "four-meme", name: "FourMeme", chain: "bsc", status: "provider_required", execution_mode: "live_confirmation_required" },
    ],
  };
}

export function mockInviteSummary() {
  return {
    mode: "unavailable",
    data_status: "not_configured",
    invite_code: null,
    invited_users: null,
    valid_launches: null,
    current_revenue_share: null,
    cumulative_revenue_share: null,
    settlement_asset: null,
  };
}

export function mockSettings() {
  return {
    mode: "live",
    preferences: {
      language: "zh-CN",
      default_chain: "solana",
      sse_enabled: true,
      require_confirmation_for_funds: true,
    },
    safety: {
      real_execution_enabled: true,
      private_key_custody: "server_provider_or_encrypted_vault",
      signing: "confirmation_required",
      broadcasting: "confirmation_required",
    },
  };
}
