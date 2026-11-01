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

import {
  ArrowLeft,
  Loader2,
  Save,
  AlertTriangle,
  Hexagon,
  Terminal,
  Cpu,
  Info,
  ShieldCheck,
  Plus,
  FileText,
} from "lucide-react";

import { motion } from "framer-motion";

import { GlassCard } from "@/components/ui/glass-card";

const DEFAULT_TEMPLATE: GovernanceTemplateId = "signal";

export default function CreateProposalPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [templateId, setTemplateId] =
    useState<GovernanceTemplateId>(DEFAULT_TEMPLATE);

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
    () =>
      GOVERNANCE_TEMPLATES.find((t) => t.id === templateId) ??
      GOVERNANCE_TEMPLATES[0],

    [templateId],
  );

  const draftImpact = useMemo(() => {
    if (templateId === "signal") {
      return null;
    }
    try {
      if (useAdvancedJson || templateId === "custom_json") {
        const data = JSON.parse(formData.executionData) as Record<
          string,
          unknown
        >;
        const type =
          templateId === "custom_json"
            ? formData.customApiType
            : template.apiType;
        return { apiType: type, executionData: data };
      }
      const validationError = validateTemplateValues(templateId, fieldValues);
      if (validationError) return null;
      return {
        apiType: template.apiType,
        executionData: buildExecutionDataFromTemplate(
          templateId,
          fieldValues,
        ) as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }, [
    templateId,
    template.apiType,
    fieldValues,
    formData.executionData,
    formData.customApiType,
    useAdvancedJson,
  ]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
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

      if (
        !Number.isInteger(durationDays) ||
        durationDays < 1 ||
        durationDays > 14
      ) {
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

        executionPayload = buildExecutionDataFromTemplate(
          templateId,
          fieldValues,
        );
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

      setError(
        err instanceof Error ? err.message : "Failed to create proposal",
      );
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
      className="governance-editor max-w-3xl mx-auto space-y-8 pb-16"
    >
      <button
        onClick={() => router.back()}
        className="group flex items-center gap-3 text-sm font-black tracking-wide text-muted-foreground hover:text-primary transition-all uppercase"
      >
        <div className="p-2 rounded-lg bg-secondary border border-border group-hover:border-primary/40 group-hover:bg-primary/5 transition-all">
          <ArrowLeft size={14} />
        </div>
        Back to governance
      </button>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-primary text-sm font-semibold tracking-wide">
          <Plus size={12} /> Governance / New proposal
        </div>

        <div>
          <h1 className="text-4xl font-semibold tracking-tighter leading-none text-foreground">
            Create Proposal
          </h1>

          <p className="text-muted-foreground font-mono text-sm mt-3 uppercase tracking-wide max-w-lg">
            Choose a validated template or use advanced JSON. Payloads are
            checked before on-chain submission.
          </p>
        </div>
      </div>

      <GlassCard className="!p-10 border-border relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
          <Cpu size={180} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
          <div className="space-y-3">
            <label
              htmlFor="proposal-title"
              className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2"
            >
              <Hexagon size={12} className="text-primary" /> Proposal Title
            </label>

            <input
              type="text"
              id="proposal-title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              minLength={5}
              maxLength={255}
              className="w-full bg-background border border-border p-4 rounded-xl font-black text-sm text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-muted-foreground"
              placeholder="e.g. Reduce platform fee to 8%"
            />

            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              Use at least 5 characters.
            </p>
          </div>

          <div className="space-y-3">
            <label
              htmlFor="proposal-template"
              className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2"
            >
              <Terminal size={12} className="text-primary" /> Proposal Template
            </label>

            <select
              id="proposal-template"
              aria-label="Proposal template"
              value={templateId}
              onChange={(e) =>
                handleTemplateChange(e.target.value as GovernanceTemplateId)
              }
              className="w-full bg-background border border-border p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none appearance-none transition-all cursor-pointer"
            >
              {GOVERNANCE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}

              <option value="custom_json">Advanced — raw JSON</option>
            </select>

            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              Maps to API type: {template.apiType.replace(/_/g, " ")}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-3 md:col-span-2">
              <label
                htmlFor="proposal-durationDays"
                className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2"
              >
                <Info size={12} className="text-primary" /> Voting Duration
                (days)
              </label>

              <input
                type="number"
                id="proposal-durationDays"
                name="durationDays"
                min={1}
                max={14}
                value={formData.durationDays}
                onChange={handleChange}
                required
                className="w-full bg-background border border-border p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all"
              />

              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                On-chain voting window: 1–14 days. Each linked wallet casts one
                vote. Abstain is not supported on-chain. Quorum is enforced when
                closing from DB fallback.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label
              htmlFor="proposal-description"
              className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2"
            >
              <FileText size={12} className="text-primary" /> Proposal
              description
            </label>

            <textarea
              id="proposal-description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              required
              minLength={20}
              rows={6}
              className="w-full bg-background border border-border p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-muted-foreground resize-none leading-relaxed"
              placeholder="Detailed technical specification and rationale for this consensus adjustment..."
            />

            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              Min 20 characters — {formData.description.trim().length}/20
            </p>
          </div>

          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-semibold tracking-wide text-muted-foreground flex items-center gap-2">
                <Cpu size={12} className="text-primary" /> Execution Payload
              </label>

              {templateId !== "custom_json" && template.fields.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUseAdvancedJson((v) => !v)}
                  className="text-xs font-semibold tracking-wide text-primary/70 hover:text-primary"
                >
                  {useAdvancedJson ? "Use template form" : "Edit as JSON"}
                </button>
              )}
            </div>

            {templateId === "custom_json" && (
              <div className="space-y-3">
                <label
                  htmlFor="proposal-customApiType"
                  className="text-sm font-semibold tracking-wide text-muted-foreground"
                >
                  API proposal type
                </label>
                <select
                  id="proposal-customApiType"
                  name="customApiType"
                  value={formData.customApiType}
                  onChange={handleChange}
                  className="w-full bg-background border border-border p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none"
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
                  aria-label="Execution payload JSON"
                  id="proposal-executionData"
                  name="executionData"
                  value={formData.executionData}
                  onChange={handleChange}
                  rows={6}
                  className="w-full bg-background border border-border p-5 rounded-xl font-mono text-sm text-primary/80 focus:border-primary/50 focus:outline-none transition-all placeholder:text-muted-foreground"
                />

                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Treasury: recipient, amount, currency SOL, description ·
                  Parameter: parameter, old_value, new_value, reason · Upgrade:
                  program_id, new_version, timelock_hours
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

              <p className="text-xs text-muted-foreground font-semibold tracking-wide leading-relaxed">
                Server-side validation runs before the proposal is created
                on-chain. Invalid addresses, missing fields, or unsupported
                parameters are rejected with a clear error.
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
            <div
              role="alert"
              className="p-5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-semibold tracking-wide flex items-center gap-3 rounded-xl animate-pulse"
            >
              <AlertTriangle size={18} />
              Couldn’t publish proposal: {error}
            </div>
          )}

          <div className="pt-10 border-t border-border space-y-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-5 bg-primary text-primary-foreground rounded-2xl font-black text-xs uppercase tracking-wide flex items-center justify-center gap-3 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Save size={18} />
              )}

              {loading ? "Publishing proposal…" : "Publish proposal on-chain"}
            </button>

            <p className="text-xs text-center font-semibold tracking-wide text-muted-foreground leading-relaxed max-w-sm mx-auto">
              Requires a linked Solana wallet. When PHB_TOKEN_MINT is
              configured, proposers need ≥100 PHB. Voting is one wallet = one
              vote on-chain. Treasury transfers queue for custody — they do not
              auto-spend the hot wallet.
            </p>
          </div>
        </form>
      </GlassCard>
    </motion.div>
  );
}
