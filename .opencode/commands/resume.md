---
description: Resume the active NarraOps task from compact repository state
---

Resume NarraOps development immediately.

1. Confirm the repository root and current branch, then run `git status --short`.
2. Read `AGENTS.md`, `coordination/PROJECT_STATE.md`,
   `coordination/DECISIONS.md`, and `coordination/CURRENT_TASK.md` in that order.
3. Run `git diff` and `git diff --cached`. Treat the current code and working
   tree as newer than coordination text if they disagree.
4. Read `coordination/TASK_BOARD.md` only if you must select or reprioritize
   work.
5. Inspect only the code and tests relevant to the current task.
6. Read old handoffs, Git history, commits, or GitHub only when tracing a cause
   or when the compact files lack a required fact. Do not preload repository
   history, all handoffs, or the whole repository.
7. Continue the in-progress work directly. Preserve unrelated dirty changes,
   secrets, fund-safety boundaries, and the Vercel catch-all/bundles.
8. If `CURRENT_TASK` has no active item, take the highest unblocked meaningful
   item from `TASK_BOARD`.

Do not begin with a repository-history summary. Ask only when a genuinely new
product/security decision or irreversible real-world action requires the user;
otherwise make a safe scoped assumption and proceed.
