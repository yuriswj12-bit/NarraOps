export type PulseOpportunityStatus = "reject" | "watch" | "review" | "high_priority";
export type NarrativeStage = "emerging" | "spreading" | "crowded" | "fading" | "unknown";
export type EvidenceStatus = "available" | "dynamic_render_required" | "unavailable" | "unverified";

export interface NarrativeEvidence {
  evidenceId: string;
  sourceType: "rss" | "web" | "x" | "reddit" | "youtube" | "instagram" | "tiktok" | "onchain" | "other";
  url: string;
  publisher: string;
  title?: string | null;
  excerpt?: string | null;
  publishedAt: string | null;
  capturedAt: string;
  status: EvidenceStatus;
}

export interface PulseOpportunityCard {
  opportunityId: string;
  title: string;
  summary: string;
  status: PulseOpportunityStatus;
  stage?: NarrativeStage;
  evidence: NarrativeEvidence[];
  riskFlags: string[];
  missingEvidence: string[];
  similarTokenCount?: number | null;
  firstObservedAt: string;
  updatedAt: string;
}

export interface GoLaunchReadyPlan {
  planId: string;
  opportunityId?: string | null;
  status: "draft" | "ready_for_review" | "approved" | "simulation_complete" | "execution_disabled";
  tokenName: string;
  ticker: string;
  sourceLinks: { primary: string; secondary?: string | null };
  imageUrl?: string | null;
  chain: "solana" | "bsc" | "robinhood";
  platform: "pump_fun" | "four_meme" | "pons";
  walletGroupId?: string | null;
  riskWarnings?: string[];
  executionMode: "review_only" | "simulation" | "disabled";
  createdAt: string;
  updatedAt: string;
}

