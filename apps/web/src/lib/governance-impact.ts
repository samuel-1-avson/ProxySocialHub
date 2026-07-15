import { apiGet, apiPost } from './api/client';

export interface GovernanceImpactLine {
    label: string;
    value: string;
    hint?: string;
}

export interface GovernanceImpactPreview {
    proposal_type: string;
    summary: string;
    risk_level: 'low' | 'medium' | 'high' | string;
    lines: GovernanceImpactLine[];
    warnings?: string[];
    affected_counts: {
        active_listings: number;
    };
}

export async function fetchProposalImpact(proposalId: string): Promise<GovernanceImpactPreview> {
    const data = await apiGet<{ impact: GovernanceImpactPreview }>(
        `/v1/governance/proposals/${proposalId}/impact`
    );
    return data.impact;
}

export async function previewGovernanceImpact(
    type: string,
    executionData: Record<string, unknown> | object
): Promise<GovernanceImpactPreview> {
    const data = await apiPost<{ impact: GovernanceImpactPreview }>('/v1/governance/impact-preview', {
        type,
        execution_data: executionData,
    });
    return data.impact;
}

export function impactRiskColor(level: string): string {
    switch (level) {
        case 'high':
            return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
        case 'medium':
            return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
        default:
            return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    }
}
