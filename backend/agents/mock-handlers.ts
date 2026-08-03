// @ts-nocheck
import { randomUUID } from "node:crypto";
import { simulateExecution } from "./execution-simulator.ts";
import { resolveLaunchPlatform } from "../integrations/launch-platform-registry.ts";
import { buildDraftMetadata, fetchNarrativeLink } from "../integrations/narrative-link-adapter.ts";
import { generateStructuredLaunchContent } from "./llm-provider.ts";

function slug(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return result || fallback;
}

async function parseTradePlan(input, side, services, context) {
  const prompt = String(input.prompt || input.agent_input?.raw_input || input.agent_input?.arguments || "").trim();
  const chain = /\b(bsc|bnb)\b/i.test(prompt) ? "bsc" : "solana";
  const tokenAddress = extractContractAddress(prompt);
  const amountMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(sol|bnb|eth|usdc)\b/i);
  const percentMatch = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
  const namedGroupMatch = prompt.match(/([^\s,，]+)\s*(?:钱包组|组|wallet\s*group|group)/i);
  const groupMatch = prompt.match(/(?:wallet\s*group|钱包组|cooking\s*group|bundled\s*group)\s*[:：]?\s*([^\s,，]+)/i);
  const positionalGroup = /^\/(?:buy|sell|batch-buy|batch-sell)\b/i.test(prompt) ? prompt.split(/\s+/).at(-1) : null;
  const groupRef = namedGroupMatch?.[1] || groupMatch?.[1] || positionalGroup || null;
  const ownerUserId = context.userId || input.context?.userId || input.context?.user_id || null;
  const groups = await Promise.resolve(services.walletGroupRepository?.listGroups?.(ownerUserId) || []);
  const group = groups.find((candidate) => candidate.groupId === groupRef)
    || groups.find((candidate) => candidate.name?.toLowerCase?.() === String(groupRef || "").toLowerCase())
    || groups.find((candidate) => groupRef && candidate.name?.toLowerCase?.().includes(String(groupRef).toLowerCase()));
  const wallets = group ? await Promise.resolve(services.walletGroupRepository?.listWallets?.(group.groupId, ownerUserId) || []) : [];
  const accounts = wallets.map((wallet) => wallet.publicAddress).filter(Boolean);
  const nativeDecimals = chain === "solana" ? 9 : 18;
  const nativeAmount = amountMatch ? amountMatch[1] : null;
  const amountAtomic = nativeAmount ? decimalToAtomic(nativeAmount, nativeDecimals) : null;
  return {
    confirmation_id: randomUUID(),
    side,
    chain,
    token_address: tokenAddress,
    wallet_group_id: group?.groupId || groupRef || null,
    wallet_group_name: group?.name || groupRef || null,
    accounts,
    input_token: side === "buy" ? (chain === "solana" ? "So11111111111111111111111111111111111111112" : "0x0000000000000000000000000000000000000000") : tokenAddress,
    output_token: side === "buy" ? (tokenAddress || null) : (chain === "solana" ? "So11111111111111111111111111111111111111112" : "0x0000000000000000000000000000000000000000"),
    amount: nativeAmount,
    amount_atomic_per_wallet: amountAtomic,
    percent: percentMatch ? percentMatch[1] : null,
    percent_bps: percentMatch ? String(Math.round(Number(percentMatch[1]) * 100)) : null,
    slippage: 30,
    request_id: context.requestId,
    status: "requires_user_confirmation",
    execution_mode: "confirmation_required",
    missing: [
      ...(!tokenAddress ? ["token_address"] : []),
      ...(!group ? ["wallet_group"] : []),
      ...(side === "buy" && !amountAtomic ? ["native_amount"] : []),
      ...(side === "sell" && !percentMatch && !amountAtomic ? ["sell_amount_or_percent"] : []),
    ],
  };
}

function decimalToAtomic(value, decimals) {
  const [whole, fraction = ""] = String(value || "0").split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) return null;
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals))).toString();
}

function tradeAccounts(plan) {
  return plan.accounts.reduce((result, address) => {
    if (plan.side === "sell") result.percentBpsByWallet[address] = plan.percent_bps;
    else result.inputAmountByWallet[address] = plan.amount_atomic_per_wallet;
    return result;
  }, { inputAmountByWallet: {}, percentBpsByWallet: {} });
}

async function recoverPendingTradePlan(context, services) {
  const conversationId = context.conversationId;
  if (!conversationId || !services.conversationRepository?.get) return null;
  const conversation = await services.conversationRepository.get(conversationId);
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const blocks = Array.isArray(messages[index]?.blocks) ? messages[index].blocks : [];
    for (const block of blocks) {
      const candidate = block?.data?.pending_trade_plan || block?.pending_trade_plan;
      if (candidate?.confirmation_id && Array.isArray(candidate.accounts)) return candidate;
    }
  }
  return null;
}

export function createMockHandlers(integrations, services = {}) {
  const pendingTradePlans = new Map();
  return {
    async "agent.chat"(input, context) {
      const latestDraft = await latestConversationDraft(context, services);
      return {
        mode: "assistant",
        request: String(input.prompt || input.agent_input?.arguments || "").slice(0, 8_000),
        ...(latestDraft
          ? {
              latest_launch_context: {
                source_url:
                  latestDraft?.narrative?.canonical_url
                  || latestDraft?.narrative?.url
                  || extractPublicUrl(latestDraft?.source_prompt),
                title: latestDraft?.narrative?.title || null,
                author_name: latestDraft?.narrative?.author_name || null,
                summary: String(latestDraft?.narrative?.summary || "").slice(0, 1_200) || null,
                content: String(latestDraft?.narrative?.content || "").slice(0, 4_000) || null,
                token: latestDraft?.token || {},
              },
            }
          : {}),
      };
    },

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
      const launchContext = await resolveLaunchContext(input, context, services);
      if (launchContext.existingDraft) {
        const result = launchResultFromDraft(launchContext.existingDraft, {
          reusedExistingDraft: true,
        });
        context.emitEvent("launch_plan_ready", {
          launch_draft_id: result.launch_draft_id,
          executable: false,
          reused_existing_draft: true,
        });
        context.emitEvent("execution_disabled", { action: "launch", reason: "real_execution_disabled" });
        return { ...result, card: { type: "launch_draft", data: result } };
      }
      const narrativeUrl = launchContext.narrativeUrl;
      const narrative = await fetchNarrativeLink(narrativeUrl, {
        timeoutMs: Number(input.link_timeout_ms || 6_000),
      });
      const language = input?.context?.language === "zh" ? "zh" : "en";
      const sourceText = [
        narrative?.content,
        narrative?.summary,
        narrative?.title,
        narrative?.author_name ? `Author: ${narrative.author_name}` : null,
        input.source_text,
        input.prompt,
      ].filter(Boolean).join("\n");
      const chain = normalizeLaunchChain(input.chain || sourceText || input.prompt);
      const platform = resolveLaunchPlatform({ chain, platform: input.platform });
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
        cooking_wallet_group_id: input.cooking_wallet_group_id || null,
        bundled_wallet_group_id: input.bundled_wallet_group_id || input.wallet_group_id || null,
        preparation_status: missingFields.length ? "requires_enrichment" : "requires_wallet_selection",
        missing_fields: missingFields,
        required_user_selections: ["cooking_wallet_group_id", "bundled_wallet_group_id"],
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
        launch_parameters: {
          chain,
          platform: platform.id || input.platform || null,
          source_url: narrative.url || narrativeUrl || null,
          source_status: narrative.status,
          source_fetched: Boolean(narrative.fetched),
          token: {
            name: token.name,
            symbol: token.symbol,
            description: token.description,
            image_url: token.image_url,
            x_url: token.x_url,
            website_url: token.website_url,
          },
          missing_fields: missingFields,
          required_user_selections: ["cooking_wallet_group_id", "bundled_wallet_group_id"],
        },
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
      const plan = await parseTradePlan(input, "buy", services, context);
      pendingTradePlans.set(context.conversationId || context.taskId, plan);
      context.emitEvent("trade_confirmation_required", { confirmation_id: plan.confirmation_id, side: "buy", missing: plan.missing });
      return {
        ...plan,
        pending_trade_plan: plan,
        accounts: plan.accounts.length,
        input_amount_by_wallet: undefined,
        percent_bps_by_wallet: undefined,
        requires_confirmation: true,
        ...(plan.missing.length ? { status: "needs_input" } : {}),
      };
    },

    async "trade.sell.batch"(input, context) {
      const plan = await parseTradePlan(input, "sell", services, context);
      pendingTradePlans.set(context.conversationId || context.taskId, plan);
      context.emitEvent("trade_confirmation_required", { confirmation_id: plan.confirmation_id, side: "sell", missing: plan.missing });
      return {
        ...plan,
        pending_trade_plan: plan,
        accounts: plan.accounts.length,
        input_amount_by_wallet: undefined,
        percent_bps_by_wallet: undefined,
        requires_confirmation: true,
        ...(plan.missing.length ? { status: "needs_input" } : {}),
      };
    },

    async "trade.confirm"(input, context) {
      const key = context.conversationId || context.taskId;
      const plan = pendingTradePlans.get(key) || await recoverPendingTradePlan(context, services);
      if (!plan) return { status: "needs_input", reason: "No pending buy or sell plan is waiting for confirmation." };
      if (plan.missing.length) return { status: "needs_input", confirmation_id: plan.confirmation_id, missing: plan.missing };

      const security = await integrations.tokenSecurity?.({ chain: plan.chain, address: plan.token_address, requestId: context.requestId })
        || await integrations.analyzeToken?.({ chain: plan.chain, address: plan.token_address, includeWallets: false, requestId: context.requestId });
      if (!security || security.status !== "live") {
        return { status: "blocked", confirmation_id: plan.confirmation_id, reason: "Token security check did not return live GMGN data.", security_status: security?.status || "unavailable" };
      }
      const data = security.data || {};
      const securityRisk = data.security || data;
      if (securityRisk.honeypot === true || securityRisk.is_honeypot === true) {
        return { status: "blocked", confirmation_id: plan.confirmation_id, reason: "GMGN security check flagged this token as a honeypot.", security: securityRisk };
      }

      const { inputAmountByWallet, percentBpsByWallet } = tradeAccounts(plan);
      const execution = await integrations.executeMultiSwap?.({
        chain: plan.chain,
        accounts: plan.accounts,
        inputToken: plan.input_token,
        outputToken: plan.output_token,
        inputAmountByWallet: plan.side === "buy" ? inputAmountByWallet : undefined,
        percentBpsByWallet: plan.side === "sell" ? percentBpsByWallet : undefined,
        slippage: plan.slippage,
        requestId: context.requestId,
      });
      pendingTradePlans.delete(key);
      const orderId = execution?.data?.order_id || execution?.data?.orderId || execution?.data?.report?.order_id || null;
      const final = orderId ? await integrations.getTradeOrder?.({ chain: plan.chain, orderId, requestId: context.requestId }) : null;
      context.emitEvent(execution?.status === "live" ? "trade_submitted" : "execution_disabled", {
        confirmation_id: plan.confirmation_id,
        side: plan.side,
        order_id: orderId,
        status: execution?.status,
      });
      return { ...plan, accounts: plan.accounts.length, security, execution, order: final, order_id: orderId, status: execution?.status || "unavailable" };
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

    async "market.trending"(input, context) {
      const chain = normalizeMarketChain(input.chain || input.prompt);
      const scan = await integrations.marketTrending({
        chain,
        interval: input.interval || "1h",
        limit: input.limit || 20,
        orderBy: input.orderBy || input.order_by || "volume",
        direction: input.direction || "desc",
        filters: input.filters || [],
        platforms: input.platforms || [],
        requestId: context.requestId,
      });
      const result = marketReadOnlyResult(scan, { requested_chain: chain, interval: input.interval || "1h" });
      return { ...result, card: { type: "market_trending", data: result } };
    },

    async "market.trenches"(input, context) {
      const chain = normalizeMarketChain(input.chain || input.prompt);
      const scan = await integrations.marketTrenches({
        chain,
        types: input.types || ["new_creation", "near_completion", "completed"],
        limit: input.limit || 20,
        launchpadPlatforms: input.launchpadPlatforms || input.launchpad_platforms || [],
        filterPreset: input.filterPreset || input.filter_preset,
        sortBy: input.sortBy || input.sort_by || "created_timestamp",
        direction: input.direction || "desc",
        requestId: context.requestId,
      });
      const result = marketReadOnlyResult(scan, { requested_chain: chain });
      return { ...result, card: { type: "market_trenches", data: result } };
    },

    async "market.kline"(input, context) {
      const contractAddress = input.contract_address || input.address || extractContractAddress(input.prompt);
      const chain = normalizeAnalysisChain(input.chain || input.prompt, contractAddress);
      const scan = await integrations.marketKline({
        chain,
        address: contractAddress,
        resolution: input.resolution || "1h",
        from: input.from,
        to: input.to,
        requestId: context.requestId,
      });
      const result = marketReadOnlyResult(scan, {
        requested_chain: chain,
        contract_address: contractAddress,
        resolution: input.resolution || "1h",
      });
      return { ...result, card: { type: "market_kline", data: result } };
    },

    async "market.signal"(input, context) {
      const chain = normalizeMarketChain(input.chain || input.prompt);
      const scan = await integrations.marketSignals({
        chain,
        signalTypes: input.signalTypes || input.signal_types || [],
        requestId: context.requestId,
      });
      const result = marketReadOnlyResult(scan, { requested_chain: chain });
      return { ...result, card: { type: "market_signal", data: result } };
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
      const analysis = await integrations.analyzeMeme({ chain, address: contractAddress, contractAddress, requestId: context.requestId });
      const result = {
        mode: analysis.status === "completed" ? "live" : "data-gap",
        contract_address: contractAddress,
        analysis_status: analysis.status,
        report_status: analysis.status === "completed"
          ? "completed"
          : analysis.machine_report
            ? "data_gap"
            : "unavailable",
        ...analysis,
        source: analysis.status === "completed" ? "hertzflow" : analysis.source || "hertzflow",
        ...(analysis.reason ? { data_gap: analysis.reason } : {}),
      };
      if (analysis.machine_report) {
        result.report_preview = {
          schema: analysis.machine_report.schema,
          source: "GMGN fresh sample + HertzFlow",
          risk_score: analysis.verdict?.risk_score ?? null,
          risk_level: analysis.verdict?.risk_level || "data_gap",
          chain_state: analysis.verdict?.chain_state || "DATA_GAP",
          conclusion: analysis.verdict?.one_liner || null,
          key_findings: analysis.verdict?.signals || [],
          sampled_holders: analysis.metrics?.sampled_holder_count || 0,
          sampled_traders: analysis.metrics?.sampled_trader_count || 0,
          watchlist_count: Array.isArray(analysis.watchlist) ? analysis.watchlist.length : 0,
          data_gaps: analysis.data_gaps || [],
        };
      }
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
  if (text.includes("base")) return "base";
  if (text.includes("eth") || text.includes("ethereum")) return "eth";
  if (text.includes("robinhood") || text.includes("hood")) return "robinhood";
  return "solana";
}

function marketReadOnlyResult(scan, extra = {}) {
  return {
    mode: scan.status === "live" ? "live" : "data-gap",
    data_source: "gmgn",
    data_source_status: scan.status,
    ...extra,
    ...(scan.data !== undefined ? { data: scan.data } : {}),
    ...(scan.observed_at ? { observed_at: scan.observed_at } : {}),
    ...(scan.reason ? { data_gap: scan.reason } : {}),
  };
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

async function resolveLaunchContext(input, context, services) {
  const conversationId = context.conversationId || input?.context?.conversation_id || null;
  const directUrl = input.narrative_url || extractPublicUrl(input.prompt);
  const drafts = services.launchDraftRepository?.list
    ? await services.launchDraftRepository.list({ conversationId })
    : [];
  const conversationDrafts = (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => !conversationId || draft.conversation_id === conversationId)
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));

  if (directUrl) {
    const existingDraft = conversationDrafts.find((draft) => {
      const sourceUrl = draft?.narrative?.url || draft?.narrative?.canonical_url || draft?.source_prompt;
      return samePublicUrl(sourceUrl, directUrl);
    });
    return { narrativeUrl: directUrl, existingDraft: existingDraft || null };
  }

  if (conversationDrafts.length) {
    return {
      narrativeUrl:
        conversationDrafts[0]?.narrative?.url ||
        conversationDrafts[0]?.narrative?.canonical_url ||
        extractPublicUrl(conversationDrafts[0]?.source_prompt),
      existingDraft: conversationDrafts[0],
    };
  }

  if (conversationId && services.conversationRepository?.get) {
    const conversation = await services.conversationRepository.get(conversationId);
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== "user") continue;
      const historicalUrl = extractPublicUrl(messages[index]?.content || messages[index]?.command);
      if (historicalUrl) return { narrativeUrl: historicalUrl, existingDraft: null };
    }
  }

  return { narrativeUrl: null, existingDraft: null };
}

async function latestConversationDraft(context, services) {
  const conversationId = context?.conversationId || null;
  if (!conversationId || !services.launchDraftRepository?.list) return null;
  const drafts = await services.launchDraftRepository.list({ conversationId });
  return (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => draft?.conversation_id === conversationId)
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0] || null;
}

function samePublicUrl(left, right) {
  try {
    const normalize = (value) => {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString();
    };
    return normalize(left) === normalize(right);
  } catch {
    return String(left || "") === String(right || "");
  }
}

function launchResultFromDraft(draft, { reusedExistingDraft = false } = {}) {
  const platformId = typeof draft.platform === "string" ? draft.platform : draft.platform?.id || null;
  const requiredUserSelections = [
    ...(!draft.cooking_wallet_group_id ? ["cooking_wallet_group_id"] : []),
    ...(!draft.bundled_wallet_group_id ? ["bundled_wallet_group_id"] : []),
  ];
  return {
    ...draft,
    mode: "review-only",
    executable: false,
    submitted: false,
    reason: "real_execution_disabled",
    reused_existing_draft: reusedExistingDraft,
    required_user_selections: requiredUserSelections,
    launch_parameters: {
      chain: draft.chain || "solana",
      platform: platformId,
      source_url: draft?.narrative?.url || draft?.narrative?.canonical_url || extractPublicUrl(draft.source_prompt),
      source_status: draft?.narrative?.status || "not_provided",
      source_fetched: Boolean(draft?.narrative?.fetched),
      token: draft.token || {},
      cooking_wallet_group_id: draft.cooking_wallet_group_id || null,
      bundled_wallet_group_id: draft.bundled_wallet_group_id || null,
      missing_fields: draft.missing_fields || [],
      required_user_selections: requiredUserSelections,
    },
  };
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
  if (text.includes("base")) return "base";
  if (text.includes("eth") || text.includes("ethereum")) return "eth";
  if (text.includes("bsc") || String(contractAddress || "").startsWith("0x")) return "bsc";
  return "solana";
}
