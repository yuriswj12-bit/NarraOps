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
    const next = {
      ...current,
      ...patch,
      token,
      metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) },
      missing_fields: missing,
      preparation_status: missing.length ? "requires_enrichment" : "ready_for_user_review",
      updated_at: new Date().toISOString(),
    };
    this.#drafts.set(id, next);
    return structuredClone(next);
  }

  async list() {
    return [...this.#drafts.values()].map((draft) => structuredClone(draft));
  }
}
