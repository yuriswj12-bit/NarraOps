// @ts-nocheck
import { randomUUID } from "node:crypto";

export class InMemoryLaunchDraftRepository {
  #drafts = new Map();

  async create(input) {
    const now = new Date().toISOString();
    const draft = {
      launch_draft_id: randomUUID(),
      status: "draft",
      confirmation_status: "not_confirmed",
      execution_mode: "disabled",
      signing_status: "signing_disabled",
      broadcasting_status: "broadcasting_disabled",
      created_at: now,
      updated_at: now,
      ...structuredClone(input),
      cooking_wallet_group_id:
        input.cooking_wallet_group_id || input.metadata?.cooking_wallet_group_id || null,
      bundled_wallet_group_id:
        input.bundled_wallet_group_id || input.metadata?.bundled_wallet_group_id || null,
    };
    this.#drafts.set(draft.launch_draft_id, draft);
    return structuredClone(draft);
  }

  async get(id) {
    const draft = this.#drafts.get(id);
    return draft ? structuredClone(draft) : null;
  }

  async update(id, patch = {}) {
    const current = await this.get(id);
    if (!current) return null;
    const token = {
      ...(current.token || {}),
      ...(patch.token || {}),
    };
    const missing = ["name", "symbol", "description", "image_url"].filter((field) => !token[field]);
    const cookingWalletGroupId =
      patch.cooking_wallet_group_id ??
      patch.metadata?.cooking_wallet_group_id ??
      current.cooking_wallet_group_id ??
      current.metadata?.cooking_wallet_group_id ??
      null;
    const bundledWalletGroupId =
      patch.bundled_wallet_group_id ??
      patch.metadata?.bundled_wallet_group_id ??
      current.bundled_wallet_group_id ??
      current.metadata?.bundled_wallet_group_id ??
      null;
    const requiredUserSelections = [
      ...(!cookingWalletGroupId ? ["cooking_wallet_group_id"] : []),
      ...(!bundledWalletGroupId ? ["bundled_wallet_group_id"] : []),
    ];
    const next = {
      ...current,
      ...patch,
      token,
      metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) },
      cooking_wallet_group_id: cookingWalletGroupId,
      bundled_wallet_group_id: bundledWalletGroupId,
      missing_fields: missing,
      required_user_selections: requiredUserSelections,
      preparation_status: missing.length
        ? "requires_enrichment"
        : requiredUserSelections.length
          ? "requires_wallet_selection"
          : "ready_for_user_review",
      updated_at: new Date().toISOString(),
    };
    this.#drafts.set(id, next);
    return structuredClone(next);
  }

  async list({ conversationId = null, userId = null } = {}) {
    return [...this.#drafts.values()]
      .filter((draft) => !conversationId || draft.conversation_id === conversationId)
      .filter((draft) => !userId || draft.user_id === userId)
      .map((draft) => structuredClone(draft));
  }
}
