// @ts-nocheck
import { randomUUID } from "node:crypto";

export class InMemoryLaunchDraftRepository {
  #drafts = new Map();

  create(input) {
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

  get(id) {
    const draft = this.#drafts.get(id);
    return draft ? structuredClone(draft) : null;
  }

  list() {
    return [...this.#drafts.values()].map((draft) => structuredClone(draft));
  }
}
