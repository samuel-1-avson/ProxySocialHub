import { publicApiGet, publicApiPost } from "./api/client";

export interface GovernanceImpactLine {
  label: string;
  value: string;
  hint?: string;
}

export interface GovernanceImpactPreview {
  proposal_type: string;
  summary: string;
  risk_level: "low" | "medium" | "high" | string;
  lines: GovernanceImpactLine[];
  warnings?: string[];
  affected_counts: {
    active_listings: number;
  };
}

export async function fetchProposalImpact(
  proposalId: string,
): Promise<GovernanceImpactPreview> {
  const data = await publicApiGet<{ impact: GovernanceImpactPreview }>(
    `/v1/governance/proposals/${proposalId}/impact`,
  );
  return data.impact;
}

export async function previewGovernanceImpact(
  type: string,
  executionData: Record<string, unknown> | object,
): Promise<GovernanceImpactPreview> {
  const data = await publicApiPost<{ impact: GovernanceImpactPreview }>(
    "/v1/governance/impact-preview",
    {
      type,
      execution_data: executionData,
    },
  );
  return data.impact;
}

export function impactRiskColor(level: string): string {
  switch (level) {
    case "high":
      return "text-destructive border-destructive/30 bg-destructive/10";
    case "medium":
      return "text-warning border-warning/30 bg-warning/10";
    default:
      return "text-success border-success/30 bg-success/10";
  }
}
