// @ts-nocheck
import { buildSolanaMemeForensicReport } from "./hertzflow-sol-meme.ts";

const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class HertzFlowAdapter {
  constructor({ enabled = false, marketAdapter = null, timeoutMs = 120_000 } = {}) {
    this.enabled = enabled;
    this.marketAdapter = marketAdapter;
    this.timeoutMs = timeoutMs;
  }

  async analyze({ chain = "solana", contractAddress, address, requestId } = {}) {
    const tokenAddress = String(contractAddress || address || "").trim();
    if (!tokenAddress) return { status: "awaiting_contract", provider: "hertzflow", report_path: null };
    if (chain !== "solana") {
      return { status: "unsupported_chain", provider: "hertzflow", chain, report_path: null };
    }
    if (!SOL_ADDRESS.test(tokenAddress)) {
      return { status: "invalid_contract", provider: "hertzflow", chain, report_path: null };
    }
    if (!this.enabled) {
      return {
        status: "disabled",
        provider: "hertzflow",
        chain,
        address: tokenAddress,
        report_path: null,
        reason: "HERTZFLOW_LIVE_ENABLED is false",
      };
    }
    if (!this.marketAdapter || typeof this.marketAdapter.fetchSolanaMemeResearch !== "function") {
      return {
        status: "unavailable",
        provider: "hertzflow",
        chain,
        address: tokenAddress,
        report_path: null,
        reason: "HertzFlow requires the read-only GMGN research adapter",
      };
    }

    let timeoutHandle;
    try {
      const research = await Promise.race([
        this.marketAdapter.fetchSolanaMemeResearch({ address: tokenAddress, requestId, limit: 100 }),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error("HERTZFLOW_TIMEOUT")), this.timeoutMs);
          timeoutHandle.unref?.();
        }),
      ]);
      if (research.status !== "live") {
        return {
          status: research.status === "disabled" ? "disabled" : "unavailable",
          provider: "hertzflow",
          source: "hertzflow",
          chain,
          address: tokenAddress,
          report_path: null,
          reason: research.reason || "GMGN research did not return a live sample",
          component_statuses: research.component_statuses || {},
        };
      }
      const report = buildSolanaMemeForensicReport({
        address: tokenAddress,
        research,
        generatedAt: new Date().toISOString(),
      });
      if (!report.metrics?.sampled_holder_count && !report.metrics?.sampled_trader_count) {
        return {
          ...report,
          status: "data-gap",
          analysis_status: "data_gap",
          reason: "GMGN returned no holder/trader rows; the forensic conclusion is intentionally withheld",
        };
      }
      return report;
    } catch (error) {
      return {
        status: error?.message === "HERTZFLOW_TIMEOUT" ? "timeout" : "unavailable",
        provider: "hertzflow",
        source: "hertzflow",
        chain,
        address: tokenAddress,
        report_path: null,
        reason: "HertzFlow live research failed",
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
