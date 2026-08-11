// @ts-nocheck
import { randomUUID } from "node:crypto";
import { resolveLaunchPlatform } from "../integrations/launch-platform-registry.ts";
import { buildDraftMetadata, fetchNarrativeLink } from "../integrations/narrative-link-adapter.ts";
import { generateStructuredLaunchContent } from "./llm-provider.ts";

function slug(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return result || fallback;
}

async function parseTradePlan(input, side, services, context, readWalletGroups) {
  const prompt = String(input.prompt || input.agent_input?.raw_input || input.agent_input?.arguments || "").trim();
  const chain = /\b(bsc|bnb)\b/i.test(prompt) ? "bsc" : "solana";
  const tokenAddress = extractContractAddress(prompt);
  const amountMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(sol|bnb|eth|usdc)\b/i);
  const percentMatch = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
  const namedGroupMatch = prompt.match(/([^\s,，]+)\s*(?:钱包组|组|wallet\s*group|group)/i);
  const groupMatch = prompt.match(/(?:wallet\s*group|钱包组|cooking\s*group|bundled\s*group)\s*[:：]?\s*([^\s,，]+)/i);
  const positionalGroup = /^\/(?:buy|sell|batch-buy|batch-sell)\b/i.test(prompt) ? prompt.split(/\s+/).at(-1) : null;
  const groupRef = groupMatch?.[1] || namedGroupMatch?.[1] || positionalGroup || null;
  const ownerUserId = context.userId || input.context?.userId || input.context?.user_id || null;
  const walletGroupRead = await readWalletGroups(ownerUserId, context);
  const groups = walletGroupRead.groups;
  const group = groups.find((candidate) => candidate.groupId === groupRef)
    || groups.find((candidate) => candidate.name?.toLowerCase?.() === String(groupRef || "").toLowerCase())
    || groups.find((candidate) => groupRef && candidate.name?.toLowerCase?.().includes(String(groupRef).toLowerCase()));
  const wallets = group ? await Promise.resolve(services.walletGroupRepository?.listWallets?.(group.groupId, ownerUserId) || []) : [];
  const activeWallets = wallets.filter((wallet) => wallet.provisioningStatus === "active" && wallet.publicAddress);
  const accounts = activeWallets.map((wallet) => wallet.publicAddress).filter(Boolean);
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
    slippage_bps: 300,
    request_id: context.requestId,
    status: "requires_user_confirmation",
    execution_mode: "confirmation_required",
    ...(walletGroupRead.tool
      ? { wallet_context_tool: walletGroupRead.tool }
      : {}),
    missing: [
      ...(!tokenAddress ? ["token_address"] : []),
      ...(!group ? ["wallet_group"] : []),
      ...(side === "buy" && !amountAtomic ? ["native_amount"] : []),
      ...(side === "sell" && !percentMatch && !amountAtomic ? ["sell_amount_or_percent"] : []),
      ...(group && !activeWallets.length ? ["wallet_group_not_ready"] : []),
    ],
  };
}

function decimalToAtomic(value, decimals) {
  const [whole, fraction = ""] = String(value || "0").split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) return null;
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals))).toString();
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

export function createAgentHandlers(integrations, services = {}) {
  const pendingTradePlans = new Map();
  const generateLaunchContent = (input, context) => (
    services.modelContentGenerator
      ? services.modelContentGenerator(input, context)
      : generateStructuredLaunchContent(input)
  );
  const executeReadTool = async (name, version, input, context, permissions) => {
    if (!services.toolRegistry) return null;
    const controller = new AbortController();
    return services.toolRegistry.execute(name, version, {
      requestId: context.requestId,
      traceId: context.requestId,
      taskId: context.taskId,
      actor: {
        actorId: context.userId || "anonymous",
        permissions,
      },
      policy: {
        profile: "agent-task",
        permissions,
      },
      idempotencyKey: `${context.requestId}:${name}:${version}`,
      signal: controller.signal,
      emit: async (event) => {
        context.emitEvent(event.type, event.payload);
      },
    }, input);
  };
  const readPublicLink = async (url, timeoutMs, context) => {
    const toolResult = await executeReadTool(
      "research.public_link.read",
      "1.0.0",
      { url, timeoutMs },
      context,
      ["research:read"],
    );
    return {
      data: toolResult?.status === "succeeded"
        ? toolResult.data
        : await fetchNarrativeLink(url, { timeoutMs }),
      tool: toolResult
        ? { name: "research.public_link.read", version: "1.0.0" }
        : null,
    };
  };
  const readWalletGroups = async (ownerUserId, context) => {
    const toolResult = await executeReadTool(
      "assets.wallet_groups.list",
      "1.0.0",
      {},
      context,
      ["assets:read"],
    );
    return {
      groups: toolResult?.status === "succeeded"
        ? toolResult.data.groups
        : await Promise.resolve(
            services.walletGroupRepository?.listGroups?.(ownerUserId) || [],
          ),
      tool: toolResult
        ? { name: "assets.wallet_groups.list", version: "1.0.0" }
        : null,
    };
  };
  return {
    async "agent.chat"(input, context) {
      const latestDraft = await latestConversationDraft(context, services);
      const safeResolvedContext = input?.context?.resolved_context?.safeModelContext;
      return {
        mode: "assistant",
        request: String(input.prompt || input.agent_input?.arguments || "").slice(0, 8_000),
        ...(safeResolvedContext ? { context: safeResolvedContext } : {}),
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
      const sourceUrl = extractPublicUrl(input.prompt || input.query || input.source_url || "");
      const linkRead = sourceUrl
        ? await readPublicLink(sourceUrl, Number(input.link_timeout_ms || 8_000), context)
        : null;
      const narrative = linkRead?.data
        || { status: "data-gap", reason: "A public source URL is required for live narrative scanning" };
      const result = {
        scanId: `scan_${context.taskId}`,
        mode: narrative.status === "live" ? "live" : "data-gap",
        ...(linkRead?.tool ? { tool: linkRead.tool } : {}),
        signals: narrative.status === "live" ? [{
          signalId: `sig_${context.taskId}_1`,
          title: narrative.title || narrative.summary || "Live public source",
          summary: narrative.summary || narrative.content || null,
          source: narrative.url || sourceUrl,
          observedAt: new Date().toISOString(),
        }] : [],
        ...(narrative.status === "live" ? {} : { data_gap: narrative.reason || "Live narrative source was unavailable" }),
      };
      context.emitEvent("narrative_detected", { signal_count: result.signals.length });
      return result;
    },

    async "narrative.generate"(input, context) {
      const base = input.brief || input.signalId || "agent narrative";
      const generated = await generateLaunchContent({
        prompt: String(base),
        sourceText: String(base),
        language: input?.context?.language === "zh" ? "zh" : "en",
      }, context);
      const ticker = slug(generated.content.symbol || base, "narra").replaceAll("-", "").slice(0, 8).toUpperCase();
      const result = {
        narrativeId: `nar_${context.taskId}`,
        mode: generated.used_llm ? "live_llm" : "unavailable",
        name: generated.content.name || null,
        ticker,
        thesis: generated.content.narrative_thesis || null,
        riskNotes: generated.content.risk_notes || [],
        provider: generated.provider,
        ...(generated.used_llm ? {} : { reason: "A configured LLM provider is required to generate narrative copy." }),
      };
      context.emitEvent("narrative_detected", { narrative_id: result.narrativeId });
      return result;
    },

    async "launch.package"(input, context) {
      const result = {
        packageId: `pkg_${context.taskId}`,
        execution_mode: "live",
        execution_status: "draft",
        chain: input.chain || "solana",
        platform: input.platform || (input.chain === "bsc" ? "FourMeme" : "Pump.fun"),
        narrativeId: input.narrativeId,
        checklist: ["Review narrative", "Review token metadata", "Review community plan", "Require explicit execution approval"],
      };
      context.emitEvent("launch_plan_ready", { package_id: result.packageId, executable: true });
      return result;
    },

    async "narrative.recommend"(input, context) {
      const topic = input.prompt || "social meme opportunities";
      const toolResult = await executeReadTool(
        "pulse.narratives.list",
        "1.0.0",
        { topic, limit: 12 },
        context,
        ["pulse:read"],
      );
      const candidates = toolResult?.status === "succeeded"
        ? toolResult.data.narratives
        : services.narrativeRepository?.listActive
          ? await services.narrativeRepository.listActive({ topic, limit: 12 })
          : [];
      const result = {
        mode: candidates.length ? "live" : "data-gap",
        topic,
        ...(toolResult
          ? { tool: { name: "pulse.narratives.list", version: "1.0.0" } }
          : {}),
        recommendations: candidates.map((candidate) => ({
          narrative_id: candidate.narrative_id,
          title: candidate.original_text,
          source_url: candidate.source_url,
          category: candidate.category,
          platform: candidate.platform,
          author_name: candidate.author_name,
          published_at: candidate.published_at,
          media_type: candidate.media_type,
          media_urls: candidate.media_urls || [],
        })),
        ...(candidates.length ? {} : { reason: "No live Pulse narrative candidates are available for this request." }),
      };
      context.emitEvent("narrative_detected", { opportunity_count: result.recommendations.length });
      return { ...result, card: { type: "narrative_snapshot", data: result } };
    },

    async "meme.create"(input, context) {
      const prompt = input.prompt || "agent-native meme";
      const generated = await generateLaunchContent({
        prompt: String(prompt),
        sourceText: String(prompt),
        language: input?.context?.language === "zh" ? "zh" : "en",
      }, context);
      const ticker = slug(generated.content.symbol || prompt, "narra").replaceAll("-", "").slice(0, 8).toUpperCase();
      const result = {
        mode: generated.used_llm ? "live_llm" : "unavailable",
        draft_id: `meme_${context.taskId}`,
        name: generated.content.name || null,
        ticker,
        narrative: generated.content.description || generated.content.narrative_thesis || null,
        publishable: Boolean(generated.used_llm),
        provider: generated.provider,
        ...(generated.used_llm ? {} : { reason: "A configured LLM provider is required to generate meme metadata." }),
      };
      context.emitEvent("meme_draft_ready", { draft_id: result.draft_id, ticker });
      return { ...result, card: { type: "meme_package", data: result } };
    },

    async "wallet.group.create"(_input, _context) {
      return {
        status: "unsupported",
        mode: "live",
        reason: "Create or provision wallet groups in Assets so every address and signer binding is visible before execution.",
      };
    },

    async "launch.meme"(input, context) {
      const launchContext = await resolveLaunchContext(input, context, services);
      if (launchContext.existingDraft) {
        const result = launchResultFromDraft(launchContext.existingDraft, {
          reusedExistingDraft: true,
        });
        context.emitEvent("launch_plan_ready", {
          launch_draft_id: result.launch_draft_id,
          executable: true,
          reused_existing_draft: true,
        });
        return { ...result, card: { type: "launch_draft", data: result } };
      }
      const narrativeUrl = launchContext.narrativeUrl;
      const linkRead = await readPublicLink(
        narrativeUrl,
        Number(input.link_timeout_ms || 6_000),
        context,
      );
      const narrative = linkRead.data;
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
      const generated = await generateLaunchContent({
        prompt: input.prompt || "",
        sourceText,
        language,
      }, context);
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
          ...(linkRead.tool ? { research_tool: linkRead.tool } : {}),
        },
      };
      const draft = services.launchDraftRepository?.create
        ? await services.launchDraftRepository.create(draftInput)
        : {
            launch_draft_id: null,
            ...draftInput,
            preparation_status: "repository_unavailable",
            execution_mode: "live",
          };
      const result = {
        ...draft,
        execution_mode: "live",
        execution_status: "draft",
        executable: Boolean(draft.launch_draft_id),
        submitted: false,
        reason: missingFields.length || !draft.launch_draft_id ? "awaiting_enrichment_or_wallet_selection" : "awaiting_user_confirmation",
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
            telegram_url: token.telegram_url,
            website_url: token.website_url,
            initial_buy: token.initial_buy,
            bundle_buy_total: token.bundle_buy_total,
            bundle_buy_per_wallet: token.bundle_buy_per_wallet,
          },
          missing_fields: missingFields,
          required_user_selections: ["cooking_wallet_group_id", "bundled_wallet_group_id"],
        },
      };
      context.emitEvent("launch_plan_ready", { launch_draft_id: result.launch_draft_id, executable: result.executable });
      return { ...result, card: { type: "launch_draft", data: result } };
    },

    async "funds.transfer"(input, context) {
      return { status: "unsupported", mode: "live", reason: "Use Assets for wallet-group management. Chat transfer execution is not exposed." };
    },

    async "funds.withdraw"(input, context) {
      return { status: "unsupported", mode: "live", reason: "Use Assets for wallet-group management. Chat withdrawal execution is not exposed." };
    },

    async "trade.buy.batch"(input, context) {
      const plan = await parseTradePlan(
        input,
        "buy",
        services,
        context,
        readWalletGroups,
      );
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
      const plan = await parseTradePlan(
        input,
        "sell",
        services,
        context,
        readWalletGroups,
      );
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
        return { status: "blocked", confirmation_id: plan.confirmation_id, reason: "Token security check did not return live market data.", security_status: security?.status || "unavailable" };
      }
      const data = security.data || {};
      const securityRisk = data.security || data;
      if (securityRisk.honeypot === true || securityRisk.is_honeypot === true) {
        return { status: "blocked", confirmation_id: plan.confirmation_id, reason: "The market security check flagged this token as a honeypot.", security: securityRisk };
      }

      if (plan.chain !== "solana") {
        return { status: "blocked", confirmation_id: plan.confirmation_id, reason: "Direct wallet Swap currently supports Solana only." };
      }
      if (plan.accounts.length !== 1) {
        return {
          status: "blocked",
          confirmation_id: plan.confirmation_id,
          reason: "Direct wallet Swap currently requires a wallet group with exactly one active wallet. Select a one-wallet Assets group so the browser can sign it.",
          accounts: plan.accounts.length,
        };
      }
      const execution = await integrations.prepareDirectSwap?.({
        walletAddress: plan.accounts[0],
        inputToken: plan.input_token,
        outputToken: plan.output_token,
        amountAtomic: plan.amount_atomic_per_wallet,
        percentBps: plan.side === "sell" ? plan.percent_bps : null,
        slippageBps: Number(plan.slippage_bps || 300),
        requestId: context.requestId,
      });
      pendingTradePlans.delete(key);
      context.emitEvent(execution?.status === "requires_user_signature" ? "trade_confirmation_required" : "execution_unavailable", {
        confirmation_id: plan.confirmation_id,
        side: plan.side,
        status: execution?.status,
      });
      return {
        ...plan,
        accounts: plan.accounts.length,
        security,
        execution,
        status: execution?.status || "unavailable",
        requires_user_signature: execution?.status === "requires_user_signature",
        card: { type: "direct_swap", data: { ...plan, security, execution } },
      };
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
      const toolInput = {
        chain,
        interval: input.interval || "1h",
        limit: input.limit || 20,
        orderBy: input.orderBy || input.order_by || "volume",
        direction: input.direction || "desc",
        filters: input.filters || [],
        platforms: input.platforms || [],
      };
      const toolResult = await executeReadTool(
        "market.gmgn.trending",
        "2.0.0",
        toolInput,
        context,
        ["market:read"],
      );
      const scan = toolResult?.status === "succeeded"
        ? toolResult.data
        : await integrations.marketTrending({
            ...toolInput,
            requestId: context.requestId,
          });
      const result = marketReadOnlyResult(scan, {
        requested_chain: chain,
        interval: input.interval || "1h",
        ...(toolResult
          ? { tool: { name: "market.gmgn.trending", version: "2.0.0" } }
          : {}),
      });
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
        source: analysis.source || "gmgn",
        ...(analysis.reason ? { data_gap: analysis.reason } : {}),
      };
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

    async "account.launches.summary"(input, context) {
      const ownerUserId = context.userId || input.context?.userId || input.context?.user_id || null;
      if (!services.userAnalytics || !ownerUserId) {
        return {
          mode: "data-gap",
          reason: "user_analytics_unavailable",
          code: "USER_ANALYTICS_UNAVAILABLE",
          card: { type: "user_launch_summary", data: {} },
        };
      }
      const summary = await services.userAnalytics.launchSummary(ownerUserId, {
        since: input.time_range && /^\d+[dh]$/i.test(String(input.time_range))
          ? new Date(Date.now() - Number(String(input.time_range).slice(0, -1)) * 3600_000 * (String(input.time_range).endsWith("d") ? 24 : 1)).toISOString()
          : undefined,
      });
      return { ...summary, card: { type: "user_launch_summary", data: summary } };
    },

    async "account.project.performance"(input, context) {
      const ownerUserId = context.userId || input.context?.userId || input.context?.user_id || null;
      if (!services.userAnalytics || !ownerUserId) {
        return {
          mode: "data-gap",
          reason: "user_analytics_unavailable",
          code: "USER_ANALYTICS_UNAVAILABLE",
          card: { type: "user_project_performance", data: {} },
        };
      }
      const performance = await services.userAnalytics.projectPerformance(ownerUserId);
      return { ...performance, card: { type: "user_project_performance", data: performance } };
    },

    async "account.pnl.summary"(input, context) {
      const ownerUserId = context.userId || input.context?.userId || input.context?.user_id || null;
      if (!services.userAnalytics || !ownerUserId) {
        return {
          mode: "data-gap",
          reason: "user_analytics_unavailable",
          code: "USER_ANALYTICS_UNAVAILABLE",
          card: { type: "user_pnl_summary", data: {} },
        };
      }
      const history = await services.userAnalytics.executionHistory(ownerUserId);
      const confirmedLaunches = history.launches.filter(({ status }) => status === "confirmed").length;
      return {
        ...history,
        mode: "actor_scoped",
        data_status: history.execution_count ? "live" : "empty",
        realized_pnl_sol: null,
        unrealized_pnl_sol: null,
        confirmed_launches: confirmedLaunches,
        card: { type: "user_pnl_summary", data: { ...history, confirmed_launches: confirmedLaunches } },
      };
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
    mode: "live",
    executable: Boolean(draft.launch_draft_id),
    submitted: false,
    reason: requiredUserSelections.length ? "awaiting_wallet_selection" : "awaiting_user_confirmation",
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
