// @ts-nocheck
// Actor-scoped user analytics for the Go Agent. Queries only the authenticated
// user's own rows and returns safe aggregates. Never exposes secrets.

export function createUserAnalyticsService(supabase) {
  if (!supabase) return null;

  async function listUserLaunches(userId, { limit = 50, since } = {}) {
    if (!userId) return [];
    let query = supabase
      .from("go_launch_drafts")
      .select("launch_draft_id,status,confirmation_status,chain,platform,token,narrative,metadata,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query;
    if (error) throw Object.assign(new Error(error.message || "Unable to read user launches"), {
      code: error.code || "USER_LAUNCHES_READ_FAILED",
    });
    return data || [];
  }

  function launchToken(draft) {
    const token = draft?.token || {};
    const execution = draft?.metadata?.direct_execution || {};
    const name = token.name || execution.name || draft?.narrative?.title || null;
    const symbol = token.symbol || execution.symbol || null;
    const txHash = execution.tx_hash || null;
    const tokenAddress = execution.token_address || execution.mint_address || null;
    const bundledBuys = Array.isArray(execution.bundled_buys) ? execution.bundled_buys : [];
    const bundledTotal = execution.bundled_buy_total || null;
    const cookingAmount = token.initial_buy || execution.developer_buy_lamports || null;
    return { name, symbol, txHash, tokenAddress, bundledBuys, bundledTotal, cookingAmount };
  }

  async function launchSummary(userId, { since } = {}) {
    const drafts = await listUserLaunches(userId, { limit: 200, since });
    const confirmed = drafts.filter(({ confirmation_status, status }) =>
      confirmation_status === "confirmed" || status === "confirmed");
    const pending = drafts.filter(({ confirmation_status, status }) =>
      ["requires_user_signature", "submitted", "reconciliation_required"].includes(
        confirmation_status || status,
      ));
    const failed = drafts.filter(({ confirmation_status, status }) =>
      confirmation_status === "failed" || status === "failed");
    const total = drafts.length;
    return {
      mode: "actor_scoped",
      data_status: total ? "live" : "empty",
      total_launches: total,
      confirmed_launches: confirmed.length,
      pending_launches: pending.length,
      failed_launches: failed.length,
      unique_wallet_groups: new Set(
        drafts.map((draft) =>
          draft?.metadata?.cooking_wallet_group_id
          || draft?.metadata?.bundled_wallet_group_id
          || null,
        ).filter(Boolean),
      ).size,
      launches_with_bundled_buys: drafts.filter((draft) => {
        const execution = draft?.metadata?.direct_execution || {};
        return execution.bundled_buy_total && Array.isArray(execution.bundled_buys) && execution.bundled_buys.length;
      }).length,
      recent: drafts.slice(0, 10).map((draft) => ({
        launch_draft_id: draft.launch_draft_id,
        status: draft.confirmation_status || draft.status,
        ...launchToken(draft),
        created_at: draft.created_at,
      })),
    };
  }

  async function projectPerformance(userId, { limit = 50 } = {}) {
    const drafts = await listUserLaunches(userId, { limit });
    const confirmed = drafts.filter(({ confirmation_status, status }) =>
      confirmation_status === "confirmed" || status === "confirmed");
    return {
      mode: "actor_scoped",
      data_status: confirmed.length ? "live" : "empty",
      projects: confirmed.map((draft) => {
        const token = launchToken(draft);
        const bundledBuys = token.bundledBuys || [];
        const bundledSubmitted = bundledBuys.filter((buy) => buy.status === "confirmed").length;
        const bundledFailed = bundledBuys.filter((buy) => buy.status === "failed").length;
        return {
          launch_draft_id: draft.launch_draft_id,
          token_name: token.name,
          token_symbol: token.symbol,
          token_address: token.tokenAddress,
          tx_hash: token.txHash,
          cooking_amount: token.cookingAmount,
          bundled_buy_total: token.bundledTotal,
          bundled_buy_count: bundledBuys.length,
          bundled_buy_confirmed: bundledSubmitted,
          bundled_buy_failed: bundledFailed,
          created_at: draft.created_at,
        };
      }),
    };
  }

  async function executionHistory(userId, { limit = 100 } = {}) {
    const drafts = await listUserLaunches(userId, { limit });
    const transfers = [];
    if (userId) {
      const { data, error } = await supabase
        .from("asset_transfers")
        .select("transfer_id,status,transactions,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && Array.isArray(data)) {
        for (const transfer of data) {
          const transactions = Array.isArray(transfer.transactions) ? transfer.transactions : [];
          transfers.push({
            kind: "transfer",
            id: transfer.transfer_id,
            status: transfer.status,
            tx_hashes: transactions.map((tx) => tx.txHash).filter(Boolean),
            created_at: transfer.created_at,
          });
        }
      }
    }
    const launches = drafts
      .filter((draft) => {
        const execution = draft?.metadata?.direct_execution || {};
        return execution.tx_hash;
      })
      .map((draft) => ({
        kind: "launch",
        id: draft.launch_draft_id,
        status: draft.confirmation_status || draft.status,
        tx_hash: launchToken(draft).txHash,
        token_address: launchToken(draft).tokenAddress,
        created_at: draft.created_at,
      }));
    return {
      mode: "actor_scoped",
      data_status: launches.length || transfers.length ? "live" : "empty",
      execution_count: launches.length + transfers.length,
      launches,
      transfers,
    };
  }

  return {
    launchSummary,
    projectPerformance,
    executionHistory,
    listUserLaunches,
  };
}
