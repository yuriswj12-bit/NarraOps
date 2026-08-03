// @ts-nocheck
export function walletCapabilities(config = {}) {
  const embeddedConfigured = Boolean(config.privyAppId);
  return {
    custody_policy: "provider_managed_only",
    raw_private_keys_accepted: false,
    raw_private_keys_stored: false,
    signing: "provider_bound",
    broadcasting: "provider_bound",
    providers: [
      {
        id: "external_wallet",
        login_methods: ["wallet"],
        chains: ["solana", "bsc", "robinhood"],
        status: "frontend_connection_required",
      },
      {
        id: "privy_embedded",
        login_methods: ["email", "wallet"],
        chains: ["solana", "bsc", "robinhood"],
        status: embeddedConfigured ? "configured" : "provider_configuration_required",
      },
    ],
  };
}
