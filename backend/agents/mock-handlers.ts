// @ts-nocheck
import { simulateExecution } from "./execution-simulator.ts";
import { resolveLaunchPlatform } from "../integrations/launch-platform-registry.ts";
import { buildDraftMetadata, prepareNarrativeLink } from "../integrations/narrative-link-adapter.ts";
import { generateStructuredLaunchContent } from "./llm-provider.ts";

function slug(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return result || fallback;
}

export function createMockHandlers(integrations, services = {}) {
  return {
    async "narrative.scan"(input, context) {
      const sources = input.sources?.length ? input.sources : [{ platform: "X", handle: input.query || "market pulse" }];
      const observations = await Promise.all(
        sources.map((source) => integrations.get(source.platform)?.preview(source, context) ?? integrations.get("custom").preview(source, context)),
      );
      const result = {
        scanId: `scan_${context.taskId}`,
        mode: "mock",
        signals: observations.map((observation, index) => ({
          signalId: `sig_${context.taskId}_${index + 1}`,
          title: observation.summary,
          score: Math.max(60, 92 - index * 6),
          source: observation.source,
          observedAt: new Date().toISOString(),
        })),
      };
      context.emitEvent("narrative_detected", { signal_count: result.signals.length });
      return result;
    },

    async "narrative.generate"(input, context) {
      const base = input.brief || input.signalId || "agent narrative";
      const ticker = slug(base, "narra").replaceAll("-", "").slice(0, 8).toUpperCase();
      const result = {
        narrativeId: `nar_${context.taskId}`,
        mode: "mock",
        name: `${base.slice(0, 48)} Protocol`,
        ticker,
        thesis: `A simulated launch narrative derived from: ${base.slice(0, 240)}`,
        riskNotes: ["Mock output only", "Requires human review before publication"],
      };
      context.emitEvent("narrative_detected", { narrative_id: result.narrativeId });
      return result;
    },

    async "launch.package"(input, context) {
      const execution = simulateExecution("launch_simulation", input);
      const result = {
        ...execution,
        packageId: `pkg_${context.taskId}`,
        chain: input.chain || "solana",
        platform: input.platform || (input.chain === "bsc" ? "FourMeme" : "Pump.fun"),
        narrativeId: input.narrativeId,
        checklist: ["Review narrative", "Review token metadata", "Review community plan", "Require explicit execution approval"],
      };
      context.emitEvent("launch_plan_ready", { package_id: result.packageId, executable: false });
      context.emitEvent("execution_disabled", { action: "launch", reason: "real_execution_disabled" });
      return result;
    },

    async "narrative.recommend"(input, context) {
      const topic = input.prompt || "social meme opportunities";
      const result = {
        mode: "mock",
        topic,
        recommendations: [
          { title: `${topic} is accelerating across short-form media`, heat: 86, risk: "medium", recommended_chain: "solana" },
          { title: `Counter-narrative around ${topic}`, heat: 72, risk: "high", recommended_chain: "bsc" },
        ],
      };
      context.emitEvent("narrative_detected", { opportunity_count: result.recommendations.length });
      return { ...result, card: { type: "narrative_snapshot", data: result } };
    },

    async "meme.create"(input, context) {
      const prompt = input.prompt || "agent-native meme";
      const ticker = slug(prompt, "narra").replaceAll("-", "").slice(0, 8).toUpperCase();
      const result = {
        mode: "mock",
        draft_id: `meme_${context.taskId}`,
        name: `${prompt.slice(0, 48)} Meme`,
        ticker,
        narrative: `Mock meme concept generated from: ${prompt.slice(0, 240)}`,
        publishable: false,
      };
      context.emitEvent("meme_draft_ready", { draft_id: result.draft_id, ticker });
      return { ...result, card: { type: "meme_package", data: result } };
    },

    async "wallet.group.create"(input, context) {
      const execution = simulateExecution("wallet_group_create_simulation", input);
      const result = {
        ...execution,
        plan_id: `wgp_${context.taskId}`,
        name: input.name || input.prompt || "Simulated wallet group",
        wallet_count: Number.isInteger(input.wallet_count) ? Math.min(Math.max(input.wallet_count, 1), 100) : 10,
        keys_generated: false,
      };
      context.emitEvent("wallet_group_plan_ready", { plan_id: result.plan_id, wallet_count: result.wallet_count });
      return result;
    },

    async "launch.meme"(input, context) {
      const chain = normalizeLaunchChain(input.chain || input.prompt);
      const platform = resolveLaunchPlatform({ chain, platform: input.platform });
      const narrativeUrl = input.narrative_url || extractPublicUrl(input.prompt);
      const narrative = prepareNarrativeLink(narrativeUrl);
      const language = input?.context?.language === "zh" ? "zh" : "en";
      const sourceText = [
        narrative?.title,
        narrative?.summary,
        input.source_text,
        input.prompt,
      ].filter(Boolean).join("\n");
      const generated = await generateStructuredLaunchContent({
        prompt: input.prompt || "",
        sourceText,
        language,
      });
      const token = buildDraftMetadata({
        narrative,
        token: {
          name: generated.content.name,
          symbol: generated.content.symbol,
          description: generated.content.description,
          ...(input.token || {}),
        },
      });
      if (!token.image_url) token.image_url = null;
      const missingFields = ["name", "symbol", "description", "image_url"].filter((field) => !token[field]);
      const draftInput = {
        chain,
        platform,
        narrative: {
          ...narrative,
          thesis: generated.content.narrative_thesis,
          risk_notes: generated.content.risk_notes,
        },
        source_prompt: input.prompt || null,
        token,
        dev_wallet_id: input.dev_wallet_id || null,
        wallet_group_id: input.wallet_group_id || null,
        preparation_status: missingFields.length ? "requires_enrichment" : "ready_for_user_review",
        missing_fields: missingFields,
        requires_user_confirmation: true,
        conversation_id: context.conversationId || input?.context?.conversation_id || null,
        user_id: input?.context?.user_id || null,
        metadata: {
          content_provider: generated.provider,
          used_llm: Boolean(generated.used_llm),
        },
      };
      const draft = services.launchDraftRepository?.create
        ? await services.launchDraftRepository.create(draftInput)
        : {
            launch_draft_id: null,
            ...draftInput,
            preparation_status: "repository_unavailable",
            execution_mode: "disabled",
          };
      const execution = simulateExecution("launch_simulation", input);
      const result = {
        ...execution,
        ...draft,
        executable: false,
        submitted: false,
        reason: "real_execution_disabled",
        content_provider: generated.provider,
        used_llm: Boolean(generated.used_llm),
      };
      context.emitEvent("launch_plan_ready", { launch_draft_id: result.launch_draft_id, executable: false });
      context.emitEvent("execution_disabled", { action: "launch", reason: "real_execution_disabled" });
      return { ...result, card: { type: "launch_draft", data: result } };
    },

    async "funds.transfer"(input, context) {
      const result = simulateExecution("transfer_simulation", input);
      context.emitEvent("transfer_simulated", { simulation_id: result.simulation_id, action: "transfer", submitted: false });
      context.emitEvent("execution_disabled", { action: "transfer", reason: "real_execution_disabled" });
      return result;
    },

    async "funds.withdraw"(input, context) {
      const result = simulateExecution("withdraw_simulation", input);
      context.emitEvent("transfer_simulated", { simulation_id: result.simulation_id, action: "withdraw", submitted: false });
      context.emitEvent("execution_disabled", { action: "withdraw", reason: "real_execution_disabled" });
      return result;
    },

    async "trade.buy.batch"(input, context) {
      const result = simulateExecution("batch_buy_simulation", input);
      context.emitEvent("trade_simulated", { simulation_id: result.simulation_id, side: "buy", submitted: false });
      context.emitEvent("execution_disabled", { action: "batch_buy", reason: "real_execution_disabled" });
      return result;
    },

    async "trade.sell.batch"(input, context) {
      const result = simulateExecution("batch_sell_simulation", input);
      context.emitEvent("trade_simulated", { simulation_id: result.simulation_id, side: "sell", submitted: false });
      context.emitEvent("execution_disabled", { action: "batch_sell", reason: "real_execution_disabled" });
      return result;
    },

    async "dev.market.scan"(input, context) {
      const chain = normalizeMarketChain(input.chain || input.prompt);
      const scan = await integrations.scanDevWallets({ chain, limit: input.limit || 20, requestId: context.requestId });
      const registered = services.devWalletRepository?.registerFromTokens(scan.tokens, scan.observed_at) || 0;
      services.devWalletRepository?.applyStats(scan.wallet_stats, scan.observed_at);
      const result = {
        mode: scan.status === "live" ? "live" : "data-gap",
        data_source: "gmgn",
        data_source_status: scan.status,
        requested_chain: chain,
        registered_dev_wallets: registered,
        pnl_enrichment_status: scan.wallet_stats_status || "enrichment_pending",
        compared_with: "previous_snapshot",
        dev_wallets: services.devWalletRepository?.list({ chain }) || [],
        ...(scan.reason ? { data_gap: scan.reason } : {}),
      };
      return { ...result, card: { type: "dev_market", data: result } };
    },

    async "narrative.trends"(input, context) {
      const scans = await Promise.all([
        integrations.scanDevWallets({ chain: "solana", limit: 40, requestId: context.requestId }),
        integrations.scanDevWallets({ chain: "bsc", limit: 40, requestId: context.requestId }),
      ]);
      const tokens = scans.flatMap((scan) => scan.tokens || []);
      const result = {
        mode: scans.some(({ status }) => status === "live") ? "live" : "data-gap",
        data_source: "gmgn",
        source_statuses: Object.fromEntries(scans.map((scan, index) => [index === 0 ? "solana" : "bsc", scan.status])),
        time_range: input.time_range || input.prompt || "7d",
        scoring_status: tokens.length ? "metadata_evidence_only" : "ai_provider_or_market_data_required",
        narratives: tokens.slice(0, 20).map((token) => ({
          label: token.name || token.symbol || "Unnamed meme",
          score: null,
          chains: [token.chain],
          launches: 1,
          evidence: [{ token_address: token.token_address, source: "gmgn" }],
        })),
      };
      context.emitEvent("narrative_detected", { opportunity_count: result.narratives.length });
      return { ...result, card: { type: "narrative_trends", data: result } };
    },

    async "meme.analyze"(input, context) {
      const contractAddress = input.contract_address || extractContractAddress(input.prompt);
      const chain = normalizeAnalysisChain(input.chain || input.prompt, contractAddress);
      const analysis = await integrations.analyzeMeme({ chain, contractAddress });
      const result = { mode: analysis.status === "completed" ? "live" : "data-gap", contract_address: contractAddress, analysis_status: analysis.status, ...analysis };
      return { ...result, card: { type: "meme_analysis", data: result } };
    },

    async "account.recent-summary"(input, context) {
      const drafts = services.launchDraftRepository?.list
        ? await services.launchDraftRepository.list()
        : [];
      const devWallets = services.devWalletRepository?.list() || [];
      const result = {
        mode: "repository_snapshot",
        data_status: "partial_until_auth_and_persistent_repository_are_configured",
        time_range: input.time_range || input.prompt || "7d",
        launch_drafts: drafts.length,
        confirmed_launches: 0,
        profit_usd: null,
        dev_wallets_registered: devWallets.length,
        dev_wallets_used: drafts.filter(({ dev_wallet_id }) => dev_wallet_id).length,
        wallet_groups_used: 0,
        pending_confirmations: drafts.filter(({ confirmation_status }) => confirmation_status === "not_confirmed").length,
      };
      return { ...result, card: { type: "recent_summary", data: result } };
    },
  };
}

function normalizeMarketChain(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("bsc") || text.includes("bnb")) return "bsc";
  if (text.includes("robinhood") || text.includes("hood")) return "robinhood";
  return "solana";
}

function extractContractAddress(value) {
  const text = String(value || "");
  return text.match(/0x[a-fA-F0-9]{40}/)?.[0]
    || text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0]
    || null;
}

function extractPublicUrl(value) {
  return String(value || "").match(/https?:\/\/[^\s]+/i)?.[0] || null;
}

function normalizeLaunchChain(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("robinhood") || text.includes("pons")) return "robinhood";
  if (text.includes("bsc") || text.includes("bnb") || text.includes("fourmeme")) return "bsc";
  return "solana";
}

function normalizeAnalysisChain(value, contractAddress) {
  const text = String(value || "").toLowerCase();
  if (text.includes("robinhood")) return "robinhood";
  if (text.includes("bsc") || String(contractAddress || "").startsWith("0x")) return "bsc";
  return "solana";
}
