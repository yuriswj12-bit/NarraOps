// @ts-nocheck
const PLATFORMS = Object.freeze([
  {
    id: "pump",
    name: "Pump.fun",
    chain: "solana",
    preparation_status: "ready",
    integration_status: "preparation_ready",
    execution_mode: "live_confirmation_required",
  },
  {
    id: "fourmeme",
    name: "FourMeme",
    chain: "bsc",
    preparation_status: "ready",
    integration_status: "preparation_ready",
    execution_mode: "live_confirmation_required",
  },
  {
    id: "pons",
    name: "Pons",
    chain: "robinhood",
    chain_id: 4663,
    factory_address: "0x0c37a24f5d23a486fa692d1500881d698b1f77a4",
    launch_method: "launchToken((string,string,string,string,(string,string,string,string,string),address),uint256,uint256,bytes32)",
    launch_fee_wei: "500000000000000",
    preparation_status: "ready",
    integration_status: "browser_wallet_ready",
    execution_mode: "live_confirmation_required",
    browser_execution_mode: "direct_wallet_confirmation",
  },
]);

const ALIASES = new Map([
  ["pump.fun", "pump"],
  ["pump", "pump"],
  ["fourmeme", "fourmeme"],
  ["four.meme", "fourmeme"],
  ["pons.family", "pons"],
  ["pons", "pons"],
]);

export function listLaunchPlatforms() {
  return PLATFORMS.map((platform) => structuredClone(platform));
}

export function resolveLaunchPlatform({ chain, platform } = {}) {
  const normalizedPlatform = ALIASES.get(String(platform || "").toLowerCase());
  const match = normalizedPlatform
    ? PLATFORMS.find(({ id }) => id === normalizedPlatform)
    : PLATFORMS.find((candidate) => candidate.chain === chain);
  return match ? structuredClone(match) : null;
}
