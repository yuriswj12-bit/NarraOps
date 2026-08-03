// @ts-nocheck

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value, fallback = "narra") {
  const result = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return result || fallback;
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map((item) => String(item || "").trim()).filter(Boolean))];
}

export function listPulseOpportunities(snapshot) {
  return asArray(snapshot?.opportunities);
}

export function findPulseOpportunity(snapshot, opportunityId) {
  const id = String(opportunityId || "").trim();
  if (!id) return null;
  return listPulseOpportunities(snapshot).find((item) => item.opportunityId === id) || null;
}

export function selectPulseOpportunity(snapshot, { opportunityId, message, command } = {}) {
  const requestedId = String(opportunityId || "").trim();
  if (requestedId) {
    return findPulseOpportunity(snapshot, requestedId);
  }

  const haystack = `${command || ""} ${message || ""}`.trim();
  if (!haystack) return listPulseOpportunities(snapshot)[0] || null;

  const byId = listPulseOpportunities(snapshot).find((item) => haystack.includes(item.opportunityId));
  if (byId) return byId;

  const lowered = haystack.toLowerCase();
  return (
    listPulseOpportunities(snapshot).find((item) => {
      const title = String(item.title || "").toLowerCase();
      const summary = String(item.summary || "").toLowerCase();
      return (title && lowered.includes(title)) || (summary && lowered.includes(summary.slice(0, 48)));
    }) || null
  );
}

export function buildPulseExecutionPlan(opportunity, options = {}) {
  if (!opportunity) {
    return {
      ok: false,
      status: 404,
      code: "PULSE_OPPORTUNITY_NOT_FOUND",
      message: "No reviewed Pulse opportunity matched the request",
    };
  }

  const evidence = asArray(opportunity.evidence);
  const missingEvidence = asArray(opportunity.missingEvidence);
  const riskFlags = asArray(opportunity.riskFlags);
  const publishers = uniqueStrings(evidence.map((item) => item.publisher));
  const sourceUrls = uniqueStrings(evidence.map((item) => item.url));
  const primaryUrl = sourceUrls[0] || null;
  const title = String(opportunity.title || "Untitled narrative").trim();
  const summary = String(opportunity.summary || "").trim();
  const symbolSeed = slug(title, "narra").replaceAll("-", "").slice(0, 8).toUpperCase() || "NARRA";
  const readyForDraft = evidence.length > 0;
  const blockedBy = uniqueStrings([
    ...riskFlags,
    ...missingEvidence.map((item) => `Missing evidence: ${item}`),
    readyForDraft ? null : "No public evidence is attached to this opportunity.",
  ]);

  const plan = {
    schema_version: "go.plan.v1",
    mode: "pulse_evidence",
    data_status: options.dataStatus || "reviewed_snapshot",
    execution: "live_confirmation_required",
    opportunity_id: opportunity.opportunityId,
    title,
    summary,
    status: opportunity.status || "review",
    stage: opportunity.stage || "unknown",
    observed_at: opportunity.updatedAt || opportunity.firstObservedAt || options.observedAt || null,
    evidence_count: evidence.length,
    evidence_gap_count: missingEvidence.length,
    publishers,
    source_urls: sourceUrls,
    risk_flags: riskFlags,
    missing_evidence: missingEvidence,
    recommended_chain: "solana",
    recommended_platform: "Pump.fun",
    token_draft: {
      name: title.slice(0, 48),
      symbol: symbolSeed,
      description: summary.slice(0, 280) || null,
      website_url: primaryUrl,
      image_url: null,
    },
    launch_checklist: [
      "Confirm public evidence and original authorship",
      "Fill missing evidence gaps listed below",
      "Review name, ticker, and image before any wallet selection",
      "Request explicit approval immediately before signing and broadcasting",
    ],
    blocked_by: blockedBy,
    next_actions: [
      "Verify the original social post and engagement band.",
      "Check prior tokenization and copycat saturation before naming.",
      "Choose chain/platform and a Cooking wallet group only after human review.",
      "Execution starts only after the launch draft is explicitly confirmed.",
    ],
    executable: false,
    requires_user_confirmation: true,
  };

  return {
    ok: true,
    status: 200,
    body: {
      schema_version: "go.plan.v1",
      mode: "pulse_evidence",
      data_status: plan.data_status,
      execution: "live_confirmation_required",
      opportunity,
      plan,
      card: {
        type: "execution_plan",
        status: "editable",
        data: plan,
      },
      message: {
        role: "assistant",
        content:
          "Built a launch plan from the selected Pulse opportunity. Confirm the editable launch fields to continue to live execution.",
        suggestion:
          "Review evidence gaps and risk flags first, then continue into a launch draft only after manual confirmation.",
      },
    },
  };
}

export function buildPulsePlanResponse(snapshot, request = {}) {
  const opportunity = selectPulseOpportunity(snapshot, request);
  return buildPulseExecutionPlan(opportunity, {
    dataStatus: snapshot?.data_status || snapshot?.dataStatus || "reviewed_snapshot",
    observedAt: snapshot?.observed_at || snapshot?.observedAt || null,
  });
}
