# Pulse Market Activity Index — Design QA

## Visual target

- Reference: `qa/pulse-market-reference.png`
- Implementation: `qa/pulse-market-index.png`
- Viewport: 1777 × 887
- Route: `/app.html#pulse`

## Checks

- Passed: first card uses the reference hierarchy: title and help affordance, large index value, 24-hour delta, compact trend area, and supporting metrics.
- Passed: black, white, and purple brand palette is preserved; the trend accent uses the reference magenta.
- Passed: the card remains honest while the 30-day baseline is unavailable and does not render fabricated values.
- Passed: the existing three-card grid and responsive page structure remain unchanged.
- Passed: the methodology control has an accessible label and exposes the index explanation on hover or keyboard focus.

## Intentional differences

- The card name is `Meme Market Activity Index`, matching the agreed product definition rather than the reference's placeholder `Dev Wallet Intelligence`.
- The current local API has no production observations, so the verified state shows baseline collection instead of example numbers or a synthetic chart.
- The page heading and the other two cards were not redesigned because this change is scoped to the first Pulse card.

## Final result

Passed.
