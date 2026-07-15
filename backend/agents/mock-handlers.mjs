function slug(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return result || fallback;
}

export function createMockHandlers(integrations) {
  return {
    async "narrative.scan"(input, context) {
      const sources = input.sources?.length ? input.sources : [{ platform: "X", handle: input.query || "market pulse" }];
      const observations = await Promise.all(
        sources.map((source) => integrations.get(source.platform)?.preview(source, context) ?? integrations.get("custom").preview(source, context)),
      );
      return {
        scanId: `scan_${context.taskId}`,
        mode: "mock",
        signals: observations.map((observation, index) => ({
          signalId: `sig_${context.taskId}_${index + 1}`,
          title: observation.summary,
          score: Math.max(60, 92 - index * 6),
          source: observation.source,
          observedAt: new Date().toISOString(),
        })),
      };
    },

    async "narrative.generate"(input, context) {
      const base = input.brief || input.signalId || "agent narrative";
      const ticker = slug(base, "narra").replaceAll("-", "").slice(0, 8).toUpperCase();
      return {
        narrativeId: `nar_${context.taskId}`,
        mode: "mock",
        name: `${base.slice(0, 48)} Protocol`,
        ticker,
        thesis: `A simulated launch narrative derived from: ${base.slice(0, 240)}`,
        riskNotes: ["Mock output only", "Requires human review before publication"],
      };
    },

    async "launch.package"(input, context) {
      return {
        packageId: `pkg_${context.taskId}`,
        mode: "planning-only",
        chain: input.chain || "solana",
        platform: input.platform || (input.chain === "bsc" ? "FourMeme" : "Pump.fun"),
        narrativeId: input.narrativeId,
        checklist: ["Review narrative", "Review token metadata", "Review community plan", "Require explicit execution approval"],
        executable: false,
      };
    },
  };
}
