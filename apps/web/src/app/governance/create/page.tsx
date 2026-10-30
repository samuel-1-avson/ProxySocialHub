"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createProposal } from "@/lib/services/governance";
import {
    GOVERNANCE_TEMPLATES,
    buildExecutionDataFromTemplate,
    validateTemplateValues,
    type GovernanceTemplateId,
} from "@/lib/governance-templates";
import { GovernanceTemplateFields } from "@/components/governance/GovernanceTemplateFields";
import { ProposalImpactPreview } from "@/components/governance/ProposalImpactPreview";
import { PageHeading } from "@/components/workspace/Patterns";
import { Loader2 } from "lucide-react";

const DEFAULT_TEMPLATE: GovernanceTemplateId = "signal";

export default function CreateProposalPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [templateId, setTemplateId] = useState<GovernanceTemplateId>(DEFAULT_TEMPLATE);
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [useAdvancedJson, setUseAdvancedJson] = useState(false);
    const [formData, setFormData] = useState({
        title: "",
        description: "",
        durationDays: "7",
        executionData: "{}",
        customApiType: "parameter_change",
    });
    const [error, setError] = useState("");

    const template = useMemo(
        () => GOVERNANCE_TEMPLATES.find((t) => t.id === templateId) ?? GOVERNANCE_TEMPLATES[0],
        [templateId],
    );

    const draftImpact = useMemo(() => {
        if (templateId === "signal") {
            return null;
        }
        try {
            if (useAdvancedJson || templateId === "custom_json") {
                const data = JSON.parse(formData.executionData) as Record<string, unknown>;
                const type = templateId === "custom_json" ? formData.customApiType : template.apiType;
                return { apiType: type, executionData: data };
            }
            const validationError = validateTemplateValues(templateId, fieldValues);
            if (validationError) return null;
            return {
                apiType: template.apiType,
                executionData: buildExecutionDataFromTemplate(templateId, fieldValues) as Record<string, unknown>,
            };
        } catch {
            return null;
        }
    }, [templateId, template.apiType, fieldValues, formData.executionData, formData.customApiType, useAdvancedJson]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleFieldChange = (key: string, value: string) => {
        setFieldValues((prev) => ({ ...prev, [key]: value }));
    };

    const handleTemplateChange = (id: GovernanceTemplateId) => {
        setTemplateId(id);
        setFieldValues({});
        setUseAdvancedJson(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const title = formData.title.trim();
            const description = formData.description.trim();
            if (title.length < 5) {
                throw new Error("Title must be at least 5 characters");
            }
            if (description.length < 20) {
                throw new Error("Description must be at least 20 characters");
            }

            const durationDays = Number(formData.durationDays);
            if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 14) {
                throw new Error("Voting duration must be between 1 and 14 days");
            }

            let executionPayload: unknown;
            let apiType = template.apiType;

            if (useAdvancedJson) {
                try {
                    executionPayload = JSON.parse(formData.executionData);
                } catch {
                    throw new Error("Invalid JSON in execution payload");
                }
            } else if (templateId === "custom_json") {
                try {
                    executionPayload = JSON.parse(formData.executionData);
                } catch {
                    throw new Error("Invalid JSON in execution payload");
                }
                apiType = formData.customApiType;
            } else {
                const validationError = validateTemplateValues(templateId, fieldValues);
                if (validationError) {
                    throw new Error(validationError);
                }
                executionPayload = buildExecutionDataFromTemplate(templateId, fieldValues);
            }

            const created = await createProposal({
                title,
                description,
                durationDays,
                type: apiType,
                executionData: executionPayload,
            });
            router.push(`/governance/${created.id}`);
        } catch (err) {
            console.error("Failed to create proposal", err);
            setError(err instanceof Error ? err.message : "Failed to create proposal");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="ui-page max-w-3xl min-w-0">
            <button type="button" onClick={() => router.back()} className="ui-link text-sm text-left">
                Back
            </button>

            <PageHeading
                eyebrow="Governance"
                title="Create Proposal"
                description="Choose a validated template or use advanced JSON. Payloads are checked before on-chain submission."
            />

            <section className="ui-surface min-w-0">
                <form onSubmit={handleSubmit} className="space-y-6 min-w-0">
                    <label className="ui-field">
                        Proposal title
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            minLength={5}
                            maxLength={255}
                            className="ui-input w-full"
                            placeholder="e.g. Reduce platform fee to 8%"
                        />
                        <small>Min 5 characters (API binding).</small>
                    </label>

                    <label className="ui-field">
                        Proposal template
                        <select
                            value={templateId}
                            onChange={(e) => handleTemplateChange(e.target.value as GovernanceTemplateId)}
                            className="ui-select w-full"
                        >
                            {GOVERNANCE_TEMPLATES.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.label}
                                </option>
                            ))}
                            <option value="custom_json">Advanced: raw JSON</option>
                        </select>
                        <small>Maps to API type: {template.apiType.replace(/_/g, " ")}</small>
                    </label>

                    <label className="ui-field">
                        Voting duration (days)
                        <input
                            type="number"
                            name="durationDays"
                            min={1}
                            max={14}
                            value={formData.durationDays}
                            onChange={handleChange}
                            required
                            className="ui-input w-full"
                        />
                        <small>
                            On-chain voting window: 1–14 days. Each linked wallet casts one vote. Abstain is
                            not supported on-chain. Quorum is enforced when closing from DB fallback.
                        </small>
                    </label>

                    <label className="ui-field">
                        Description
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            required
                            minLength={20}
                            rows={6}
                            className="ui-input w-full"
                            placeholder="Detailed technical specification and rationale for this consensus adjustment..."
                        />
                        <small>Min 20 characters: {formData.description.trim().length}/20</small>
                    </label>

                    <div className="space-y-4 border-t border-border pt-6">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <h2 className="text-[18px] m-0">Execution payload</h2>
                            {templateId !== "custom_json" && template.fields.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setUseAdvancedJson((v) => !v)}
                                    className="ui-button ghost small"
                                >
                                    {useAdvancedJson ? "Use template form" : "Edit as JSON"}
                                </button>
                            )}
                        </div>

                        {templateId === "custom_json" && (
                            <label className="ui-field">
                                API proposal type
                                <select
                                    name="customApiType"
                                    value={formData.customApiType}
                                    onChange={handleChange}
                                    className="ui-select w-full"
                                >
                                    <option value="parameter_change">parameter_change</option>
                                    <option value="treasury">treasury</option>
                                    <option value="upgrade">upgrade</option>
                                    <option value="slash">slash</option>
                                    <option value="text">text (signal)</option>
                                </select>
                            </label>
                        )}

                        {templateId === "custom_json" || useAdvancedJson ? (
                            <>
                                <label className="ui-field">
                                    JSON payload
                                    <textarea
                                        name="executionData"
                                        value={formData.executionData}
                                        onChange={handleChange}
                                        rows={6}
                                        className="ui-input w-full font-mono text-sm"
                                    />
                                </label>
                                <p className="ui-note">
                                    Treasury: recipient, amount, currency SOL, description · Parameter: parameter,
                                    old_value, new_value, reason · Upgrade: program_id, new_version, timelock_hours
                                </p>
                            </>
                        ) : (
                            <GovernanceTemplateFields
                                template={template}
                                values={fieldValues}
                                onChange={handleFieldChange}
                            />
                        )}

                        <p className="ui-note">
                            Server-side validation runs before the proposal is created on-chain. Invalid
                            addresses, missing fields, or unsupported parameters are rejected with a clear error.
                        </p>

                        {draftImpact ? (
                            <ProposalImpactPreview
                                mode="draft"
                                apiType={draftImpact.apiType}
                                executionData={draftImpact.executionData}
                            />
                        ) : null}
                    </div>

                    {error && (
                        <div className="ui-error" role="alert">
                            <strong>Could not create proposal</strong>
                            <p>{error}</p>
                        </div>
                    )}

                    <div className="pt-6 border-t border-border space-y-3">
                        <button type="submit" disabled={loading} className="ui-button w-full">
                            {loading ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : null}
                            {loading ? "Creating proposal…" : "Publish proposal"}
                        </button>
                        <p className="ui-note">
                            Requires a linked Solana wallet. When PHB_TOKEN_MINT is configured, proposers need
                            ≥100 PHB. Voting is one wallet = one vote on-chain. Treasury transfers queue for
                            custody. They do not auto-spend the hot wallet.
                        </p>
                    </div>
                </form>
            </section>
        </div>
    );
}
