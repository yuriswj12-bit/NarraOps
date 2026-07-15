const PLATFORMS = Object.freeze([
  {
    id: "pump",
    name: "Pump.fun",
    chain: "solana",
    preparation_status: "ready",
    integration_status: "preparation_ready",
    execution_mode: "disabled",
  },
  {
    id: "fourmeme",
    name: "FourMeme",
    chain: "bsc",
    preparation_status: "ready",
    integration_status: "preparation_ready",
    execution_mode: "disabled",
  },
  {
    id: "noxa",
    name: "Noxa.fun",
    chain: "robinhood",
    chain_id: 4663,
    preparation_status: "ready",
    integration_status: "external_docs_required",
    execution_mode: "disabled",
  },
]);

const ALIASES = new Map([
  ["pump.fun", "pump"],
  ["pump", "pump"],
  ["fourmeme", "fourmeme"],
  ["four.meme", "fourmeme"],
  ["noxa.fun", "noxa"],
  ["noxa", "noxa"],
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
