// @ts-nocheck

// These responses represent a provider data gap, not product simulation.
// They contain no synthetic market, wallet, or execution values.
export function unavailablePulse() {
  return {
    mode: "unavailable",
    data_status: "data_gap",
    opportunities: [],
    reason: "Live Pulse collection is not available in this server runtime.",
  };
}

export function unavailableInviteSummary() {
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

export function liveSettings() {
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
