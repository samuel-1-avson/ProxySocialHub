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

import { ArrowLeft, Loader2, Save, AlertTriangle, Hexagon, Terminal, Cpu, Info, ShieldCheck, Plus, FileText } from "lucide-react";

import { motion } from "framer-motion";

import { GlassCard } from "@/components/ui/glass-card";



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

        [templateId]

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

                title: formData.title,

                description: formData.description,

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



    const containerVariants = {

        hidden: { opacity: 0, y: 20 },

        show: {

            opacity: 1,

            y: 0,

            transition: { duration: 0.4, ease: "easeOut" } as const,

        },

    };



    return (

        <motion.div

            variants={containerVariants}

            initial="hidden"

            animate="show"

            className="max-w-3xl mx-auto space-y-10 pb-20 font-mono"

        >

            <button

                onClick={() => router.back()}

                className="group flex items-center gap-3 text-[10px] font-black tracking-[0.2em] text-muted-foreground/40 hover:text-primary transition-all uppercase"

            >

                <div className="p-2 rounded-lg bg-white/2 border border-white/5 group-hover:border-primary/40 group-hover:bg-primary/5 transition-all">

                    <ArrowLeft size={14} />

                </div>

                Return to Command

            </button>



            <div className="space-y-4">

                <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.4em]">

                    <Plus size={12} /> Sequence Initialization

                </div>

                <div>

                    <h1 className="text-4xl font-black uppercase tracking-tighter leading-none bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">

                        Create Proposal

                    </h1>

                    <p className="text-muted-foreground/40 font-mono text-[10px] mt-3 uppercase tracking-widest max-w-lg">

                        Choose a validated template or use advanced JSON. Payloads are checked before on-chain submission.

                    </p>

                </div>

            </div>



            <GlassCard className="!p-10 border-white/10 relative overflow-hidden group">

                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">

                    <Cpu size={180} />

                </div>



                <form onSubmit={handleSubmit} className="space-y-8 relative z-10">

                    <div className="space-y-3">

                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">

                            <Hexagon size={12} className="text-primary" /> Proposal Title

                        </label>

                        <input

                            type="text"

                            name="title"

                            value={formData.title}

                            onChange={handleChange}

                            required

                            className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-sm text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5"

                            placeholder="e.g. Reduce platform fee to 8%"

                        />

                    </div>



                    <div className="space-y-3">

                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">

                            <Terminal size={12} className="text-primary" /> Proposal Template

                        </label>

                        <select

                            value={templateId}

                            onChange={(e) => handleTemplateChange(e.target.value as GovernanceTemplateId)}

                            className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none appearance-none transition-all cursor-pointer"

                        >

                            {GOVERNANCE_TEMPLATES.map((t) => (

                                <option key={t.id} value={t.id}>

                                    {t.label}

                                </option>

                            ))}

                            <option value="custom_json">Advanced — raw JSON</option>

                        </select>

                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">

                            Maps to API type: {template.apiType.replace(/_/g, " ")}

                        </p>

                    </div>



                    <div className="grid md:grid-cols-2 gap-8">

                        <div className="space-y-3 md:col-span-2">

                            <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">

                                <Info size={12} className="text-primary" /> Voting Duration (days)

                            </label>

                            <input

                                type="number"

                                name="durationDays"

                                min={1}

                                max={14}

                                value={formData.durationDays}

                                onChange={handleChange}

                                required

                                className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all"

                            />

                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">

                                On-chain voting window: 1–14 days. Quorum uses PHB voting power (VP). Abstain is recorded on-chain but does not add to For/Against bars.

                            </p>

                        </div>

                    </div>



                    <div className="space-y-3">

                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60 flex items-center gap-2">

                            <FileText size={12} className="text-primary" /> Sequence Documentation

                        </label>

                        <textarea

                            name="description"

                            value={formData.description}

                            onChange={handleChange}

                            required

                            rows={6}

                            className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5 resize-none leading-relaxed"

                            placeholder="Detailed technical specification and rationale for this consensus adjustment..."

                        />

                    </div>



                    <div className="space-y-4 border-t border-white/5 pt-6">

                        <div className="flex items-center justify-between gap-4">

                            <label className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/60 flex items-center gap-2">

                                <Cpu size={12} className="text-primary" /> Execution Payload

                            </label>

                            {templateId !== "custom_json" && template.fields.length > 0 && (

                                <button

                                    type="button"

                                    onClick={() => setUseAdvancedJson((v) => !v)}

                                    className="text-[9px] font-black uppercase tracking-widest text-primary/70 hover:text-primary"

                                >

                                    {useAdvancedJson ? "Use template form" : "Edit as JSON"}

                                </button>

                            )}

                        </div>



                        {templateId === "custom_json" && (
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">
                                    API proposal type
                                </label>
                                <select
                                    name="customApiType"
                                    value={formData.customApiType}
                                    onChange={handleChange}
                                    className="w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none"
                                >
                                    <option value="parameter_change">parameter_change</option>
                                    <option value="treasury">treasury</option>
                                    <option value="upgrade">upgrade</option>
                                    <option value="slash">slash</option>
                                    <option value="text">text (signal)</option>
                                </select>
                            </div>
                        )}

                        {templateId === "custom_json" || useAdvancedJson ? (

                            <>

                                <textarea

                                    name="executionData"

                                    value={formData.executionData}

                                    onChange={handleChange}

                                    rows={6}

                                    className="w-full bg-black/40 border border-white/5 p-5 rounded-xl font-mono text-[10px] text-primary/80 focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5"

                                />

                                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest">

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



                        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/10 rounded-xl">

                            <ShieldCheck size={16} className="text-primary shrink-0" />

                            <p className="text-[9px] text-muted-foreground/60 font-black uppercase tracking-widest leading-relaxed">

                                Server-side validation runs before the proposal is created on-chain. Invalid

                                addresses, missing fields, or unsupported parameters are rejected with a clear error.

                            </p>

                        </div>

                        {draftImpact ? (
                            <ProposalImpactPreview
                                mode="draft"
                                apiType={draftImpact.apiType}
                                executionData={draftImpact.executionData}
                            />
                        ) : null}

                    </div>



                    {error && (

                        <div className="p-5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-3 rounded-xl animate-pulse">

                            <AlertTriangle size={18} />

                            Sequence Error: {error}

                        </div>

                    )}



                    <div className="pt-10 border-t border-white/5 space-y-4">

                        <button

                            type="submit"

                            disabled={loading}

                            className="w-full py-5 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-[0.4em] flex items-center justify-center gap-3 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"

                        >

                            {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}

                            {loading ? "Initializing Authority Link..." : "Publish On-Chain Sequence"}

                        </button>

                        <p className="text-[9px] text-center font-black uppercase tracking-[0.3em] text-muted-foreground/20 leading-relaxed max-w-sm mx-auto">

                            INITIALIZATION REQUIRES A 100 PROX STAKE DEPOSIT.

                            RESOURCES WILL BE RETURNED UPON QUORUM SUCCESS.

                        </p>

                    </div>

                </form>

            </GlassCard>

        </motion.div>

    );

}

