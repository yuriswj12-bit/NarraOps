function intFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadConfig() {
  return Object.freeze({
    host: process.env.API_HOST || "127.0.0.1",
    port: intFromEnv("API_PORT", 5190, { min: 1, max: 65535 }),
    bodyLimitBytes: intFromEnv("API_BODY_LIMIT_BYTES", 9_000_000, { min: 1024, max: 12_000_000 }),
    taskStepDelayMs: intFromEnv("AGENT_MOCK_STEP_DELAY_MS", 80, { min: 0, max: 10_000 }),
    sseHeartbeatMs: intFromEnv("SSE_HEARTBEAT_MS", 15_000, { min: 1_000 }),
    externalTimeoutMs: intFromEnv("EXTERNAL_REQUEST_TIMEOUT_MS", 5_000, { min: 100, max: 60_000 }),
    externalMaxRetries: intFromEnv("EXTERNAL_REQUEST_MAX_RETRIES", 1, { min: 0, max: 3 }),
    logLevel: process.env.LOG_LEVEL || "info",
    gmgnLiveEnabled: process.env.GMGN_LIVE_ENABLED === "true",
    gmgnCliPath: process.env.GMGN_CLI_PATH || undefined,
    privyAppId: process.env.PRIVY_APP_ID || undefined,
    hertzflowLiveEnabled: process.env.HERTZFLOW_LIVE_ENABLED === "true",
    hertzflowPythonPath: process.env.HERTZFLOW_PYTHON_PATH || "python",
    hertzflowReportScriptPath: process.env.HERTZFLOW_SOL_MEME_REPORT_SCRIPT_PATH || undefined,
    hertzflowForensicScriptPath: process.env.HERTZFLOW_SOL_MEME_FORENSIC_SCRIPT_PATH || undefined,
    hertzflowOutputRoot: process.env.HERTZFLOW_REPORT_OUTPUT_ROOT || undefined,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    bscRpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
    pumpMetadataUploadUrl: process.env.PUMP_METADATA_UPLOAD_URL || "https://pump.fun/api/ipfs",
    walletVaultPassword: process.env.WALLET_VAULT_PASSWORD || undefined,
    walletStorePath: process.env.WALLET_STORE_PATH || "./data/wallet-vault.json",
    walletGroupStorePath: process.env.WALLET_GROUP_STORE_PATH || "./data/wallet-groups.json",
    realExecutionEnabled: process.env.REAL_EXECUTION_ENABLED === "true",
  });
}
