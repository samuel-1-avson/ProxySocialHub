/**
 * Guided governance proposal templates — payloads align with control-api executor + validation.
 */

export type GovernanceTemplateId =
    | 'signal'
    | 'treasury_transfer'
    | 'platform_fee'
    | 'governance_quorum'
    | 'gateway_enforce'
    | 'protocol_upgrade'
    | 'gateway_slash'
    | 'custom_json';

export interface GovernanceTemplateField {
    key: string;
    label: string;
    type: 'text' | 'number' | 'textarea' | 'select';
    placeholder?: string;
    required?: boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: string; label: string }[];
}

export interface GovernanceTemplate {
    id: GovernanceTemplateId;
    label: string;
    description: string;
    apiType: string;
    fields: GovernanceTemplateField[];
}

export const GOVERNANCE_TEMPLATES: GovernanceTemplate[] = [
    {
        id: 'signal',
        label: 'Community signal',
        description: 'Non-executable advisory vote. No on-chain execution payload.',
        apiType: 'text',
        fields: [],
    },
    {
        id: 'treasury_transfer',
        label: 'Treasury transfer (SOL)',
        description: 'Transfer SOL from the protocol treasury after the vote passes.',
        apiType: 'treasury',
        fields: [
            { key: 'recipient', label: 'Recipient wallet', type: 'text', required: true, placeholder: 'Solana base58 address' },
            { key: 'amount', label: 'Amount (SOL)', type: 'number', required: true, min: 0.000001, step: 0.01 },
            { key: 'description', label: 'Purpose', type: 'textarea', required: true, placeholder: 'Audit trail description' },
        ],
    },
    {
        id: 'platform_fee',
        label: 'Platform fee change',
        description: 'Update marketplace platform fee (stored as protocol parameter).',
        apiType: 'parameter_change',
        fields: [
            { key: 'old_value', label: 'Current fee (%)', type: 'number', required: true, min: 0, max: 100, step: 0.1 },
            { key: 'new_value', label: 'New fee (%)', type: 'number', required: true, min: 0, max: 100, step: 0.1 },
            { key: 'reason', label: 'Rationale', type: 'textarea', required: true },
        ],
    },
    {
        id: 'governance_quorum',
        label: 'Governance quorum',
        description: 'Adjust minimum voting power required for proposal outcomes.',
        apiType: 'parameter_change',
        fields: [
            { key: 'old_value', label: 'Current quorum', type: 'number', required: true, min: 0 },
            { key: 'new_value', label: 'New quorum', type: 'number', required: true, min: 0 },
            { key: 'reason', label: 'Rationale', type: 'textarea', required: true },
        ],
    },
    {
        id: 'gateway_enforce',
        label: 'Gateway enforce mode',
        description: 'Toggle or set gateway enforcement policy (protocol parameter).',
        apiType: 'parameter_change',
        fields: [
            {
                key: 'new_value',
                label: 'Enforcement mode',
                type: 'select',
                required: true,
                options: [
                    { value: 'off', label: 'Off: monitoring only' },
                    { value: 'warn', label: 'Warn: flag violations' },
                    { value: 'enforce', label: 'Enforce: block non-compliant gateways' },
                ],
            },
            { key: 'reason', label: 'Rationale', type: 'textarea', required: true },
        ],
    },
    {
        id: 'protocol_upgrade',
        label: 'Protocol upgrade',
        description: 'Schedule a program upgrade with timelock metadata.',
        apiType: 'upgrade',
        fields: [
            { key: 'program_id', label: 'Program ID', type: 'text', required: true },
            { key: 'new_version', label: 'Version / release tag', type: 'text', required: true },
            { key: 'changelog_cid', label: 'Changelog IPFS CID (optional)', type: 'text' },
            { key: 'timelock_hours', label: 'Timelock (hours)', type: 'number', required: true, min: 0, step: 1 },
            { key: 'rollback_plan_cid', label: 'Rollback plan CID (optional)', type: 'text' },
        ],
    },
    {
        id: 'gateway_slash',
        label: 'Gateway slash',
        description: 'Slash stake for a misbehaving gateway node.',
        apiType: 'slash',
        fields: [
            { key: 'gateway_address', label: 'Gateway address', type: 'text', required: true },
            { key: 'slash_percentage', label: 'Slash %', type: 'number', required: true, min: 0, max: 100 },
            { key: 'reason', label: 'Reason', type: 'textarea', required: true },
            { key: 'evidence', label: 'Evidence IPFS CID (optional)', type: 'text' },
        ],
    },
];

export function getGovernanceTemplate(id: GovernanceTemplateId): GovernanceTemplate | undefined {
    return GOVERNANCE_TEMPLATES.find((t) => t.id === id);
}

export function buildExecutionDataFromTemplate(
    templateId: GovernanceTemplateId,
    values: Record<string, string>
): unknown {
    switch (templateId) {
        case 'signal':
            return {};
        case 'treasury_transfer':
            return {
                recipient: values.recipient?.trim(),
                amount: Number(values.amount),
                currency: 'SOL',
                description: values.description?.trim(),
            };
        case 'platform_fee':
            return {
                parameter: 'platform_fee',
                old_value: Number(values.old_value),
                new_value: Number(values.new_value),
                reason: values.reason?.trim(),
            };
        case 'governance_quorum':
            return {
                parameter: 'governance_quorum',
                old_value: Number(values.old_value),
                new_value: Number(values.new_value),
                reason: values.reason?.trim(),
            };
        case 'gateway_enforce':
            return {
                parameter: 'gateway_enforce_mode',
                old_value: values.old_value?.trim() || 'unknown',
                new_value: values.new_value,
                reason: values.reason?.trim(),
            };
        case 'protocol_upgrade':
            return {
                program_id: values.program_id?.trim(),
                new_version: values.new_version?.trim(),
                changelog_cid: values.changelog_cid?.trim() || '',
                timelock_hours: Number(values.timelock_hours ?? 24),
                rollback_plan_cid: values.rollback_plan_cid?.trim() || '',
            };
        case 'gateway_slash':
            return {
                gateway_address: values.gateway_address?.trim(),
                slash_percentage: Math.round(Number(values.slash_percentage)),
                reason: values.reason?.trim(),
                evidence: values.evidence?.trim() || '',
            };
        default:
            return {};
    }
}

export function validateTemplateValues(
    templateId: GovernanceTemplateId,
    values: Record<string, string>
): string | null {
    const template = getGovernanceTemplate(templateId);
    if (!template || templateId === 'custom_json') return null;

    for (const field of template.fields) {
        const raw = values[field.key]?.trim() ?? '';
        if (field.required && !raw) {
            return `${field.label} is required`;
        }
        if (field.type === 'number' && raw) {
            const n = Number(raw);
            if (Number.isNaN(n)) return `${field.label} must be a number`;
            if (field.min !== undefined && n < field.min) {
                return `${field.label} must be at least ${field.min}`;
            }
            if (field.max !== undefined && n > field.max) {
                return `${field.label} must be at most ${field.max}`;
            }
        }
    }

    if (templateId === 'treasury_transfer' && values.recipient) {
        if (values.recipient.trim().length < 32) {
            return 'Recipient must be a valid Solana address';
        }
    }

    return null;
}
