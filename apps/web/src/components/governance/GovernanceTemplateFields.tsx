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
    if (field.type === 'textarea') {
        return (
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={field.required}
                rows={3}
                placeholder={field.placeholder}
                className="ui-input w-full"
            />
        );
    }

    if (field.type === 'select' && field.options) {
        return (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={field.required}
                className="ui-select w-full"
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
            className="ui-input w-full"
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
            <p className="ui-note">
                This template does not require an execution payload. Voters are signaling support only.
            </p>
        );
    }

    return (
        <div className="space-y-4">
            <p className="ui-note">{template.description}</p>
            {template.fields.map((field) => (
                <label key={field.key} className="ui-field">
                    {field.label}
                    {field.required ? ' *' : ''}
                    <FieldInput
                        field={field}
                        value={values[field.key] ?? ''}
                        onChange={(v) => onChange(field.key, v)}
                    />
                </label>
            ))}
        </div>
    );
}
