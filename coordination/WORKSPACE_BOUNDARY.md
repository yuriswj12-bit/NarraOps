# Workspace boundary

Date: 2026-07-25

## Active

- `narraops-product` only
- Remote: https://github.com/yuriswj12-bit/NarraOps

## Archived locally

Moved to `../_archive/2026-07/`:

- narraops-frontend
- narraops-backend-agent
- narraops-execution
- narraops-integration-recovered
- recovery
- forgex-product-ui
- forgex-cli-main
- forgex-cli-main.zip

## Cleanup completed in product

- Removed unused brand assets and landing hero PNG
- Landing brand accents moved off emerald green
- CSS accent tokens no longer alias through `--green*`
- Theme toggle removed; single night brand theme
- Shared language key `narraops-language` (legacy landing key read-only migration)
- Launch UI/helpers isolated to `frontend/src/launch-workbench.ts`
