# Pulse Market Activity Card — Design QA

- Source visual truth:
  `C:\Users\hek\AppData\Local\Temp\codex-clipboard-89f37b19-cb16-4f93-b389-32619121c1c8.png`
- Implementation screenshots:
  - `C:\Users\hek\Documents\SOL单兵\narraops-frontend\qa\pulse-page-desktop-final.png`
  - `C:\Users\hek\Documents\SOL单兵\narraops-frontend\qa\pulse-market-card-mobile-fixed.png`
- Source pixels: 976 x 512.
- Desktop viewport: 1200 x 900 CSS px; card measured 1129 x 452 CSS px.
- Mobile viewport: 390 x 844 CSS px.
- State: dark theme, Pulse, 24H selected, nine realistic QA-only aggregate
  observations. The shipped UI never creates these points.

## Full-view comparison evidence

The implementation follows the selected hierarchy: compact title and help
control at top left, segmented ranges at top right, score beneath the header,
then a restrained purple 0-100 trend plot. The surrounding NarraOps shell was
preserved instead of copying the mock as a standalone page.

## Focused region comparison evidence

The mobile capture was used as the focused readability and responsive check.
All four range controls remain visible, the score hierarchy is preserved, axis
labels remain legible, and the card has no horizontal overflow. No raster or
decorative image assets are present in the source card, so asset-generation and
image-quality comparison were not applicable.

## Required fidelity surfaces

- Fonts and typography: existing NarraOps system font retained; title, score,
  unit, tab, and axis weights reproduce the reference hierarchy with the
  requested smaller text treatment.
- Spacing and layout rhythm: full-width desktop card, compact header, score
  spacing, chart padding, 12 px radius, and responsive stacking match the target.
- Colors and visual tokens: near-black surface, low-contrast border/grid,
  muted gray labels, purple selected control, purple line, and subtle fill match.
- Image quality and asset fidelity: no image assets exist in the target card;
  the existing Font Awesome question icon is used instead of a drawn substitute.
- Copy and content: only `Market Activity`, range labels, score, `/100`, and
  chart axes remain. Removed status and loading prose as requested.

## Comparison history

1. Initial browser pass found a P2 mobile overflow: the inherited three-column
   signal grid made the full-width KPI card 816 px wide at a 390 px viewport.
2. Fixed the <=820 px grid to one column and removed horizontal scrolling.
3. Post-fix evidence measures the card at 351 px within a 390 px viewport, all
   four tabs at 77.75 px, and no document overflow.

## Interaction and state checks

- `24H / 7D / 30D / 1Y` selection updates `aria-pressed` and chart range.
- A one-point response renders no canvas and no empty-state text.
- Browser console errors: none.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- P3: revisit axis-label density after real 30D and 1Y datasets exist.

final result: passed

## 2026-07-27 Pulse chart interaction and fixed axes

- Removed the Pulse hero subtitle, freshness timestamp, and refresh action.
- Updated the hero title to `Find the next breakout meme`.
- Added full-plot pointer tracking to the real Market Activity canvas. Moving
  anywhere inside the plot selects the nearest real observation and shows a
  vertical cursor, highlighted point, local-time timestamp, label, and score.
- Verified the tooltip changed from the 06:14 observation (`46`) to the 12:04
  observation (`35`) as the pointer moved horizontally.
- Replaced evenly divided timestamps with product-defined local-time ticks:
  3-hour ticks for 24H, daily ticks for 7D, 5-day ticks for 30D, and 12 monthly
  ticks for 1Y.
- The PnL card remains empty because no real PnL contract exists. No amount,
  axis, curve, or tooltip is fabricated.
- Desktop comparison confirms the OKX-style cursor line, active point, and
  floating tooltip fit the approved two-card layout.
- Mobile QA at 390 px found no horizontal overflow and retained a real canvas.
- The only console error was emitted by an installed wallet extension while
  redefining `window.ethereum`; no product-script error was observed.

final result: passed

## 2026-07-27 Pulse overview and Dev Wallet PnL UI

- Reworked the first Pulse layer into two equal desktop cards: `Market Activity`
  and `Dev Wallet PnL`.
- Removed the former Source Health and Candidate Pool cards from this layer.
- Updated the hero hierarchy to `Find the next breakout devs`, public-evidence
  supporting copy, freshness badge, and refresh action.
- The PnL surface is presentation-only. It renders `$—` and an empty chart until
  a real data contract is connected; no synthetic amount, percentage, curve, or
  axis labels are present.
- Added independent `24H / 7D / 30D / 1Y` UI state for PnL.
- Added compact USD presentation support for future non-negative values
  (`$7.5K`, `$7.5M`, `$15.4M`) with green positive-value styling. It does not
  calculate or fetch PnL.
- Desktop QA: both cards are 646 x 408 px at a 1380 px viewport.
- Mobile QA: cards stack at 351 x 396 px in a 390 px viewport with no horizontal
  overflow; the PnL card contains no canvas.
- Browser extension emitted one wallet-injection error unrelated to the product
  page; no application error was observed.

final result: passed
