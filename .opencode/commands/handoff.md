---
description: Save compact NarraOps state before switching provider or Agent
---

Create an accurate provider/Agent handoff without changing or cleaning the
working tree.

1. Run `git rev-parse --show-toplevel`, `git branch --show-current`,
   `git status --short`, `git diff`, and `git diff --cached`.
2. Update `coordination/CURRENT_TASK.md` with only: Goal, Completed, In
   progress, Modified files, Remaining, Known blockers, and Do not break. Keep
   it roughly 300–500 tokens and make GitHub-invisible local work explicit.
3. Sync only durable current facts into `coordination/PROJECT_STATE.md`.
4. Sync only new decisions whose rationale future Agents must preserve into
   `coordination/DECISIONS.md`.
5. Correct only meaningful task statuses in `coordination/TASK_BOARD.md`.
6. Treat current code and working tree as authoritative over old coordination
   documents. Do not copy chat logs, restate Git history, or append a diary.
7. Preserve all staged, unstaged, and untracked work. Do not stash, reset,
   commit, push, deploy, or execute funds unless the parent task separately
   authorizes that action.
8. Verify the compact takeover set is sufficient for `/resume`, then report the
   updated handoff files and any information that cannot be transferred.

Optional handoff target or note: $ARGUMENTS
