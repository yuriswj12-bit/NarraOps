// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class HertzFlowAdapter {
  constructor({ enabled = false, pythonPath = "python", reportScriptPath, forensicScriptPath, outputRoot, timeoutMs = 600_000 } = {}) {
    this.enabled = enabled;
    this.pythonPath = pythonPath;
    this.reportScriptPath = reportScriptPath;
    this.forensicScriptPath = forensicScriptPath;
    this.outputRoot = outputRoot;
    this.timeoutMs = timeoutMs;
  }

  async analyze({ chain = "solana", contractAddress }) {
    if (!contractAddress) return { status: "awaiting_contract", provider: "hertzflow", report_path: null };
    if (chain !== "solana") {
      return { status: "unsupported_chain", provider: "hertzflow", chain, report_path: null };
    }
    if (!SOL_ADDRESS.test(contractAddress)) {
      return { status: "invalid_contract", provider: "hertzflow", chain, report_path: null };
    }
    if (!this.enabled || !this.reportScriptPath || !this.forensicScriptPath || !this.outputRoot) {
      return { status: "disabled", provider: "hertzflow", chain, report_path: null, reason: "HertzFlow live mode or required reviewed paths are not configured" };
    }
    const outputDirectory = path.resolve(this.outputRoot, `${contractAddress}-sol-meme`);
    const rawDataPath = path.join(outputDirectory, ".work", "raw_data.json");
    const forensicReportPath = path.join(outputDirectory, "Forensic_Report.md");
    try {
      await execFileAsync(this.pythonPath, [this.reportScriptPath, contractAddress, "--out-dir", outputDirectory], {
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      });
      await execFileAsync(this.pythonPath, [this.forensicScriptPath, rawDataPath, "--out", forensicReportPath], {
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      });
      return {
        status: "completed",
        provider: "hertzflow",
        chain,
        freshness: "live_fetch_required",
        report_language: "zh",
        report_path: path.join(outputDirectory, "Report.md"),
        forensic_report_path: forensicReportPath,
        monitoring_path: path.join(outputDirectory, "monitoring", "monitoring_paste.json"),
      };
    } catch {
      return { status: "unavailable", provider: "hertzflow", chain, report_path: null };
    }
  }
}
