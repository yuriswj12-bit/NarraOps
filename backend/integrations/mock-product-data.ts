// @ts-nocheck
export function mockPulse() {
  const observedAt = new Date().toISOString();
  return {
    mode: "mock",
    observed_at: observedAt,
    opportunities: [
      {
        opportunity_id: "pulse_agent_pets",
        narrative: "Personal AI agents are becoming identity-bearing internet characters",
        heat: 91,
        sources: ["X/Twitter", "TikTok"],
        recommended_chain: "solana",
        risk_level: "medium",
      },
      {
        opportunity_id: "pulse_short_video_meme",
        narrative: "Short-video remix formats are crossing into on-chain communities",
        heat: 84,
        sources: ["TikTok", "Douyin"],
        recommended_chain: "bsc",
        risk_level: "high",
      },
      {
        opportunity_id: "pulse_community_lore",
        narrative: "Community-native lore is outperforming generic token branding",
        heat: 76,
        sources: ["Telegram", "GMGN"],
        recommended_chain: "solana",
        risk_level: "low",
      },
    ],
  };
}

export function mockLaunchPlatforms() {
  return {
    mode: "mock",
    execution_enabled: false,
    platforms: [
      { id: "pump-fun", name: "Pump.fun", chain: "solana", status: "mock", execution_mode: "disabled" },
      { id: "bags", name: "BAGS", chain: "solana", status: "mock", execution_mode: "disabled" },
      { id: "four-meme", name: "FourMeme", chain: "bsc", status: "mock", execution_mode: "disabled" },
    ],
  };
}

export function mockInviteSummary() {
  return {
    mode: "mock",
    invite_code: "NARRA-DEMO",
    invited_users: 24,
    valid_launches: 7,
    current_revenue_share: "0.05",
    cumulative_revenue_share: "128.40",
    settlement_asset: "USDC",
  };
}

export function mockSettings() {
  return {
    mode: "mock",
    preferences: {
      language: "zh-CN",
      default_chain: "solana",
      sse_enabled: true,
      require_confirmation_for_funds: true,
    },
    safety: {
      real_execution_enabled: false,
      private_key_custody: "disabled",
      signing: "signing_disabled",
      broadcasting: "broadcasting_disabled",
    },
  };
}
