// Read-only wallet-group adapter used by the Agent runtime on Vercel.
// Private key custody and signing stay outside this adapter.

export class SupabaseWalletGroupRepository {
  #supabase;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async listGroups(ownerUserId) {
    if (!ownerUserId) return [];
    const [{ data: groups, error: groupError }, { data: wallets, error: walletError }] = await Promise.all([
      this.#supabase
        .from("asset_wallet_groups")
        .select("group_id,name,purpose,network,created_at,updated_at")
        .eq("user_id", ownerUserId)
        .order("created_at", { ascending: false }),
      this.#supabase
        .from("asset_wallets")
        .select("group_id")
        .eq("user_id", ownerUserId),
    ]);
    if (groupError) throw groupError;
    if (walletError) throw walletError;
    const counts = new Map();
    for (const wallet of wallets || []) counts.set(wallet.group_id, (counts.get(wallet.group_id) || 0) + 1);
    return (groups || []).map((group) => this.#publicGroup(group, counts.get(group.group_id) || 0));
  }

  async listWallets(groupId, ownerUserId) {
    if (!groupId || !ownerUserId) return [];
    const { data, error } = await this.#supabase
      .from("asset_wallets")
      .select("wallet_id,group_id,public_address,provisioning_status,wallet_index,signer_reference")
      .eq("group_id", groupId)
      .eq("user_id", ownerUserId)
      .order("wallet_index", { ascending: true });
    if (error) throw error;
    return (data || []).map((wallet) => ({
      walletId: wallet.wallet_id,
      groupId: wallet.group_id,
      publicAddress: wallet.public_address,
      provisioningStatus: wallet.provisioning_status,
      providerReference: wallet.signer_reference || null,
    }));
  }

  #publicGroup(group, walletCount) {
    return {
      groupId: group.group_id,
      name: group.name,
      purpose: group.purpose,
      network: group.network,
      walletCount,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    };
  }
}

