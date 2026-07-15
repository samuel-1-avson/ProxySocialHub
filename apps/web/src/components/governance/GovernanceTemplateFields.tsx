'use client';

import type { GovernanceTemplate, GovernanceTemplateField } from '@/lib/governance-templates';

interface GovernanceTemplateFieldsProps {
    template: GovernanceTemplate;
    values: Record<string, string>;
    onChange: (key: string, value: string) => void;
}

function FieldInput({
    field,
    value,
    onChange,
}: {
    field: GovernanceTemplateField;
    value: string;
    onChange: (value: string) => void;
}) {
    const base =
        'w-full bg-black/40 border border-white/5 p-4 rounded-xl font-black text-xs text-foreground focus:border-primary/50 focus:outline-none transition-all placeholder:text-white/5';

    if (field.type === 'textarea') {
        return (
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={field.required}
                rows={3}
                placeholder={field.placeholder}
                className={`${base} resize-none leading-relaxed`}
            />
        );
    }

    if (field.type === 'select' && field.options) {
        return (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={field.required}
                className={`${base} appearance-none cursor-pointer`}
            >
                <option value="">Select…</option>
                {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <input
            type={field.type === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            className={base}
        />
    );
}

export function GovernanceTemplateFields({
    template,
    values,
    onChange,
}: GovernanceTemplateFieldsProps) {
    if (template.fields.length === 0) {
        return (
            <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest leading-relaxed">
                This template does not require an execution payload. Voters are signaling support only.
            </p>
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-[9px] font-mono text-primary/60 uppercase tracking-widest leading-relaxed">
                {template.description}
            </p>
            {template.fields.map((field) => (
                <div key={field.key} className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/60">
                        {field.label}
                        {field.required ? ' *' : ''}
                    </label>
                    <FieldInput
                        field={field}
                        value={values[field.key] ?? ''}
                        onChange={(v) => onChange(field.key, v)}
                    />
                </div>
            ))}
        </div>
    );
}
